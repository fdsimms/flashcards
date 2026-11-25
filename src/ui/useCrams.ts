import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { DAY_STARTS_AT_HOUR } from '../core/config';
import { deleteNotes, saveNote, type NoteStore } from '../anki/noteService';
import { setDueDates } from '../anki/rescheduleService';
import { cardsToCap, cramTag, finished, isRunning, withThemes, type Cram, type CramTalk } from '../core/cram';
import { noteHasTag } from '../core/priority';
import type { Card, Note } from '../core/types';
import { reviewWrites } from '../core/writeQueue';
import type { DeckRow } from '../core/deckTree';

/**
 * Crams (src/core/cram.ts) as the screens see them: read from the repo once, held here, and every
 * change reaches the screens listening, and the note editor (`cramsNow`), which tags a new note for
 * each running cram that adds new cards. Each change is written to SQLite first, then shown.
 */

let crams: Cram[] = [];
let loaded: Promise<void> | undefined;
let isLoaded = false;
const listeners = new Set<() => void>();
const notify = () => { for (const l of listeners) l(); };
// Bumped by every save and delete, so a read started before one doesn't put back what it replaced.
let changes = 0;

/** Reads the crams once; later calls wait on the same read. */
export function loadCrams(repo: NoteStore): Promise<Cram[]> {
  loaded ??= repo.listCrams().then((c) => { crams = c; isLoaded = true; notify(); }, (e) => { loaded = undefined; throw e; });
  return loaded.then(() => crams);
}

/**
 * Reads the crams again, replacing what's held: the deck list's refresh calls this (through
 * `useCramCap`), so a backup restored under the screens, or a sync, shows its crams.
 */
export async function reloadCrams(repo: NoteStore): Promise<Cram[]> {
  const started = changes;
  const fresh = await repo.listCrams();
  // A save or delete while it read is newer than what it read: keep that.
  if (started !== changes) return crams;
  crams = fresh;
  isLoaded = true;
  loaded = Promise.resolve();
  notify();
  return crams;
}

/** The crams as last read or saved, for code that can't wait (the note editor's starting tags). */
export const cramsNow = (): Cram[] => crams;

/**
 * Every cram, oldest first, kept up to date. `loaded` is false until the first read lands. Without
 * a repo yet (AppContext, before the collection opens) it reads nothing and waits for one.
 */
export function useCrams(repo: NoteStore | null): { crams: Cram[]; loaded: boolean } {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    if (repo) loadCrams(repo).catch(() => undefined);
    return () => { listeners.delete(l); };
  }, [repo]);
  return { crams, loaded: isLoaded };
}

/**
 * The time, again each minute and when the app comes back, and the collection's "Next day starts
 * at": a round that opens at 6 PM shows as ready at 6 PM without leaving the screen.
 */
export function useCramClock(repo: NoteStore): { now: Date; dayStartsAtHour: number } {
  const [now, setNow] = useState(() => new Date());
  const [dayStartsAtHour, setHour] = useState(DAY_STARTS_AT_HOUR);
  useEffect(() => {
    repo.collectionSettings().then((cs) => setHour(cs.dayStartsAtHour), () => undefined);
    const tick = setInterval(() => setNow(new Date()), 60_000);
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') setNow(new Date()); });
    return () => { clearInterval(tick); sub.remove(); };
  }, [repo]);
  return { now, dayStartsAtHour };
}

/**
 * Every note and card, read each time the screen comes into view (a word added in the note editor,
 * a card answered in Review), after Review's answers are written. `cramNotes` picks a cram's.
 */
export function useCollection(repo: Pick<NoteStore, 'listNotes' | 'listCards'>): { notes: Note[]; cards: Card[]; loaded: boolean; problem?: unknown; reload: () => void } {
  const [state, setState] = useState<{ notes: Note[]; cards: Card[]; loaded: boolean; problem?: unknown }>({ notes: [], cards: [], loaded: false });
  const seq = useRef(0);
  const reload = useCallback(() => {
    const mine = ++seq.current;
    (async () => {
      await reviewWrites.idle();
      const [notes, cards] = await Promise.all([repo.listNotes(), repo.listCards()]);
      if (mine === seq.current) setState({ notes, cards, loaded: true });
    })().catch((problem) => { if (mine === seq.current) setState((s) => ({ ...s, loaded: true, problem })); });
  }, [repo]);
  useFocusEffect(reload);
  return { ...state, reload };
}

/** Saves a cram (SQLite first), then shows it. */
export async function saveCram(repo: NoteStore, cram: Cram): Promise<void> {
  await repo.saveCram(cram);
  changes++;
  crams = [...crams.filter((c) => c.id !== cram.id), cram].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  notify();
}

/**
 * Adds or takes off a cram's tag on these notes, one note at a time through the note editor's own
 * save, so Anki gets it as it gets any edit. A note already as asked is left alone.
 */
export async function setCramTag(repo: NoteStore, cram: Cram, noteIds: Iterable<string>, on: boolean): Promise<void> {
  const tag = cramTag(cram);
  for (const id of new Set(noteIds)) {
    const note = await repo.getNote(id);
    if (!note || noteHasTag(note, tag) === on) continue;
    const tags = on ? [...note.tags, tag] : note.tags.filter((t) => t.toLowerCase() !== tag.toLowerCase());
    await saveNote(repo, { id: note.id, deck: note.deck, model: note.model, fields: note.fields, tags });
  }
}

/** Deletes the notes picked in a cram's Select mode (a screen here imports no writer itself, tests/reader/noGrading.test.ts). Each is deleted on its own, so one that fails leaves the rest done. */
export const deleteCramWords = deleteNotes;

/** A new cram: saved, its words tagged, and the last cram's words it took marked as taken. Its page caps its cards. */
export async function startCram(repo: NoteStore, cram: Cram, noteIds: string[], carriedFrom?: Cram): Promise<void> {
  await saveCram(repo, cram);
  await setCramTag(repo, cram, noteIds, true);
  // Last, so a try that failed before here still offers the same words again.
  if (carriedFrom) await saveCram(repo, { ...carriedFrom, carriedTo: cram.id });
}

/** At the lesson's Finish: the checked words are kept as used, the rest for the next cram, and the tag comes off. */
export async function finishCram(repo: NoteStore, cram: Cram, notes: Note[], used: Iterable<string>): Promise<void> {
  const ids = notes.map((n) => n.id);
  await saveCram(repo, finished(cram, ids, used, new Date()));
  await setCramTag(repo, cram, ids, false);
}

/**
 * Use theme / Use themes (Talking points' ideas): each theme's questions and story are kept on the
 * cram (which takes the first one's name when it had only a stand-in, `withThemes`), then their words
 * from the deck get the cram's tag. Saved first, so a try that failed part way keeps the themes and
 * the next try finishes the tagging.
 */
export async function applyThemes(repo: NoteStore, cram: Cram, talks: CramTalk[], noteIds: string[]): Promise<void> {
  await saveCram(repo, withThemes(cram, talks));
  await setCramTag(repo, cram, noteIds, true);
}

/** Deletes a cram, taking its tag off its words first. */
export async function deleteCram(repo: NoteStore, cram: Cram, notes: Note[]): Promise<void> {
  await setCramTag(repo, cram, notes.map((n) => n.id), false);
  await repo.deleteCram(cram.id);
  changes++;
  crams = crams.filter((c) => c.id !== cram.id);
  notify();
}

/**
 * Puts every review scheduled after a running cram's day on that day instead, with Anki's Set Due
 * Date (memory state kept; a Manual entry in the review log, as Anki writes). Waits for Review's
 * answers to be written first, so it reads each card as answered. Returns how many cards it moved.
 */
export function capCramCards(repo: NoteStore): Promise<number> {
  // One pass at a time: each reads the cards after the one before has moved them, so a card isn't
  // given Set Due Date twice (a second Manual row in Anki's review log).
  const run = capping.then(() => capOnce(repo), () => capOnce(repo));
  capping = run.then(() => undefined, () => undefined);
  return run;
}

let capping: Promise<void> = Promise.resolve();

async function capOnce(repo: NoteStore): Promise<number> {
  const all = await loadCrams(repo);
  const now = new Date();
  const { dayStartsAtHour } = await repo.collectionSettings();
  if (!all.some((c) => isRunning(c, now, dayStartsAtHour))) return 0;
  // The cards are read again for each group, after any answer still being written: an answer given
  // while an earlier group was being moved (each waits its turn for the collection) may have lapsed
  // a card, and Set Due Date from the copy read before would make it a review due on the cram's day.
  const plan = async () => {
    await reviewWrites.idle();
    const [notes, cards] = await Promise.all([repo.listNotes(), repo.listCards()]);
    return cardsToCap(all, notes, cards, now, dayStartsAtHour);
  };
  let moved = 0;
  for (const [days] of await plan()) {
    const group = (await plan()).get(days);
    if (group?.length) moved += (await setDueDates(repo, group, { min: days, max: days, forceReset: false }, now)).cards.length;
  }
  return moved;
}

/**
 * Reads the crams again and runs the cap whenever the deck list is counted again (after a sync, a
 * new study day, an import, a backup restored), so words tagged elsewhere (in Anki, or by Claude)
 * are capped too. AppContext calls this in one line. A failure is left for the cram's page to
 * show, which runs the cap itself when opened.
 */
export function useCramCap(repo: NoteStore | null, decks: DeckRow[]): void {
  useEffect(() => {
    if (!repo) return;
    reloadCrams(repo).then(() => capCramCards(repo)).catch(() => undefined);
  }, [repo, decks]);
}
