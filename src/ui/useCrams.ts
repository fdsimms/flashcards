import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { DAY_STARTS_AT_HOUR } from '../core/config';
import { saveNote, type NoteStore } from '../anki/noteService';
import { setDueDates } from '../anki/rescheduleService';
import { cardsToCap, cramTag, finished, isRunning, type Cram } from '../core/cram';
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

/** Reads the crams once; later calls wait on the same read. */
export function loadCrams(repo: NoteStore): Promise<Cram[]> {
  loaded ??= repo.listCrams().then((c) => { crams = c; isLoaded = true; notify(); }, (e) => { loaded = undefined; throw e; });
  return loaded.then(() => crams);
}

/** The crams as last read or saved, for code that can't wait (the note editor's starting tags). */
export const cramsNow = (): Cram[] => crams;

/** Every cram, oldest first, kept up to date. `loaded` is false until the first read lands. */
export function useCrams(repo: NoteStore): { crams: Cram[]; loaded: boolean } {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    loadCrams(repo).catch(() => undefined);
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
export function useCollection(repo: NoteStore): { notes: Note[]; cards: Card[]; loaded: boolean; problem?: unknown; reload: () => void } {
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

/** A new cram: saved, its words tagged, the last cram's words it took marked as taken, and its cards capped. */
export async function startCram(repo: NoteStore, cram: Cram, noteIds: string[], carriedFrom?: Cram): Promise<void> {
  await saveCram(repo, cram);
  await setCramTag(repo, cram, noteIds, true);
  if (carriedFrom) await saveCram(repo, { ...carriedFrom, carriedTo: cram.id });
  await capCramCards(repo);
}

/** At the lesson's Finish: the checked words are kept as used, the rest for the next cram, and the tag comes off. */
export async function finishCram(repo: NoteStore, cram: Cram, notes: Note[], used: Iterable<string>): Promise<void> {
  const ids = notes.map((n) => n.id);
  await saveCram(repo, finished(cram, ids, used, new Date()));
  await setCramTag(repo, cram, ids, false);
}

/** Deletes a cram, taking its tag off its words first. */
export async function deleteCram(repo: NoteStore, cram: Cram, notes: Note[]): Promise<void> {
  await setCramTag(repo, cram, notes.map((n) => n.id), false);
  await repo.deleteCram(cram.id);
  crams = crams.filter((c) => c.id !== cram.id);
  notify();
}

/**
 * Puts every review scheduled after a running cram's day on that day instead, with Anki's Set Due
 * Date (memory state kept; a Manual entry in the review log, as Anki writes). Waits for Review's
 * answers to be written first, so it reads each card as answered. Returns how many cards it moved.
 */
export async function capCramCards(repo: NoteStore): Promise<number> {
  const all = await loadCrams(repo);
  const now = new Date();
  const { dayStartsAtHour } = await repo.collectionSettings();
  if (!all.some((c) => isRunning(c, now, dayStartsAtHour))) return 0;
  await reviewWrites.idle();
  const [notes, cards] = await Promise.all([repo.listNotes(), repo.listCards()]);
  let moved = 0;
  for (const [days, group] of cardsToCap(all, notes, cards, now, dayStartsAtHour)) {
    moved += (await setDueDates(repo, group, { min: days, max: days, forceReset: false }, now)).length;
  }
  return moved;
}

/**
 * Runs the cap whenever the deck list is counted again (after a sync, a new study day, an import),
 * so words tagged elsewhere (in Anki, or by Claude) are capped too. AppContext calls this in one
 * line. A failure is left for the cram's page to show, which runs the cap itself when opened.
 */
export function useCramCap(repo: NoteStore | null, decks: DeckRow[]): void {
  const running = useRef(false);
  useEffect(() => {
    if (!repo || running.current) return;
    running.current = true;
    capCramCards(repo).catch(() => undefined).finally(() => { running.current = false; });
  }, [repo, decks]);
}
