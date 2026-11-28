// The note queue, app side: words typed in Quick add (src/ui/QuickAdd.tsx), filled in by Claude on Read & Listen's server, then
// reviewed here. Saving a note in the note editor is the approval step: nothing in this file (or the
// screens that use it) creates a note or touches a card. Pure, so it's tested.
import { bareNoun, bareVerb, genderOf } from '../core/gender';
import { duplicateOf, editTextToField } from '../core/noteEditing';
import type { WordChoice } from '../core/quickAdd';
import type { Note, NoteType } from '../core/types';
import type { Language, NoteQueue, QueuedNote } from './api';

/** The note type Claude's notes are always saved as, so a queued word's duplicate check asks about it. */
export const QUEUED_MODEL = 'Omnilanguage';

/**
 * The deck that already has `entry` as a queued note's Entry, else undefined: the check `saveNote`
 * refuses a duplicate by (`duplicateOf`), for a screen offering a word to send to the queue, so a word
 * the deck already has (as a new, unstudied card, say) isn't offered. `notes` are the collection's notes
 * still there (`notesStillThere`). A word Claude respells is caught later, by `alreadyInDeck`.
 */
export function wordInDeck(notes: Note[], deck: string, entry: string): string | undefined {
  return duplicateOf(notes, { deck, model: QUEUED_MODEL, fields: { Entry: editTextToField(entry) } }, 'Entry')?.deck;
}

/**
 * The decks Quick add can queue words for: each Read & Listen language's deck (`decks`, from its
 * settings; missing from a server older than the deck setting) that is in the collection
 * (`deckNames`). A language never studied has no deck to add to. Quick add sends these decks' words
 * to the note queue for Claude (quick-add.tsx); any other deck saves its words as notes there. The
 * language `current` (the one being read) comes first, as the one to start with.
 */
export function quickAddDecks(
  decks: Partial<Record<Language, string>> | undefined,
  deckNames: readonly string[],
  current?: Language,
): { deck: string; language: Language }[] {
  if (!decks) return [];
  const present = new Set(deckNames);
  const options = (Object.keys(decks) as Language[])
    .flatMap((language) => {
      const deck = decks[language];
      return deck && present.has(deck) ? [{ deck, language }] : [];
    });
  return [...options.filter((d) => d.language === current), ...options.filter((d) => d.language !== current)];
}

/** A failed word the server is still going to try again (`retrying`, set by the server): shown as waiting, not as failed. */
export const isRetrying = (n: QueuedNote): boolean => n.state === 'failed' && n.retrying === true;

/** Whether a word is still being worked on: waiting for Claude, or failed with tries left. */
export const isWorking = (n: QueuedNote): boolean => n.state === 'waiting' || isRetrying(n);

/** How many queued words are in each state; a word the server will retry counts as waiting. */
export function counts(items: QueuedNote[]): { ready: number; waiting: number; failed: number } {
  return {
    ready: items.filter((n) => n.state === 'ready').length,
    waiting: items.filter(isWorking).length,
    failed: items.filter((n) => n.state === 'failed' && !isRetrying(n)).length,
  };
}

export const firstReady = (items: QueuedNote[]): QueuedNote | undefined => items.find((n) => n.state === 'ready');

/**
 * The queued note for a word asked for (a cram's request), by the text that was sent, its spaces
 * collapsed as the server stores it (`routes/note_queue.py`); a ready one first, as `CramAsk` takes it.
 */
export function queuedFor(items: QueuedNote[], text: string): QueuedNote | undefined {
  const sent = text.split(/\s+/).filter(Boolean).join(' ');
  const mine = items.filter((n) => n.entry === sent);
  return mine.find((n) => n.state === 'ready') ?? mine[0];
}

/**
 * The new note a ready word starts as, for the note editor: the fields Claude wrote under the Entry,
 * and its part of speech as the tag, as the owner's finished notes carry it. A noun's article is left off
 * the Entry when its Gender gives that same article (the card shows it from the Gender), and a Norwegian
 * verb's å likewise (the card shows it before a verb). A word typed the way it sounds opens on how it's
 * really written (`spelling`), with what was typed under the Entry, or, when it could be more than one
 * word, a `choice` for the editor to ask which one was meant.
 */
export function reviewTarget(note: QueuedNote): { deck: string; model: string; fields: Record<string, string>; tags?: string[]; fieldNotes?: Record<string, string>; choice?: WordChoice } {
  const word = note.spelling || note.entry;
  const fields = { Entry: bareVerb(note.language, note.fields.PartOfSpeech ?? '', bareNoun(note.language, genderOf(note.fields.Gender ?? ''), word)), ...note.fields };
  const part = note.fields.PartOfSpeech;
  // A word added from a text carries where it was heard (src/reader/heardLine.ts): Source is among the
  // fields the server kept, and its source:: tag goes beside the part of speech.
  const tags = [part, note.heard?.tag].filter((t): t is string => !!t);
  const target = { deck: note.deck, model: QUEUED_MODEL, fields, ...(tags.length ? { tags } : {}) };
  if (needsChoice(note)) {
    const words = [{ entry: word, meaning: note.fields.Meaning ?? note.meaning }, ...(note.alternatives ?? []).map((a) => ({ entry: a.spelling, meaning: a.meaning }))];
    return { ...target, choice: { typed: note.entry, words } };
  }
  return note.spelling ? { ...target, fieldNotes: { Entry: `You typed ${note.entry}.` } } : target;
}

/**
 * Whether a ready word could be more than one word (typed the way it sounds), so the owner opens it to
 * say which one they meant. Approve all leaves it queued.
 */
export function needsChoice(note: QueuedNote): boolean {
  return note.state === 'ready' && (note.alternatives?.length ?? 0) > 0;
}

/**
 * What "Approve all" saves for a ready note: the same note the editor would open on `reviewTarget`, saved
 * as it would save it untouched. The editor's text becomes stored fields (`editTextToField`), only the
 * note type's own fields are kept (`fieldNames`, in its order), and `extraTags` (a running cram's) are added.
 */
export function approvalDraft(note: QueuedNote, fieldNames: readonly string[], extraTags: readonly string[]): { deck: string; model: string; fields: Record<string, string>; tags: string[] } {
  const target = reviewTarget(note);
  return {
    deck: target.deck,
    model: target.model,
    fields: Object.fromEntries(fieldNames.map((f) => [f, editTextToField(target.fields[f] ?? '')])),
    tags: [...new Set([...(target.tags ?? []), ...extraTags])],
  };
}

/**
 * The fields a queued note is saved with, in order: its note type's own (`reviewTarget`'s model), or the
 * fields Claude wrote when the collection has no such type yet. Approve all saves by these, and
 * `alreadyInDeck` checks by them, so the two can't disagree about the first field.
 */
export function queuedFieldNames(note: QueuedNote, noteTypes: ReadonlyMap<string, Pick<NoteType, 'fields'>>): string[] {
  const target = reviewTarget(note);
  const fromType = noteTypes.get(target.model)?.fields;
  return fromType?.length ? fromType : Object.keys(target.fields);
}

/**
 * The ready notes the deck already has, each with the deck that has it: the check `saveNote` refuses a
 * duplicate by (`duplicateOf` on the note's first field), asked of the note Approve all would save
 * (`approvalDraft`). `notes` are the collection's notes still there (`notesStillThere`), as `saveNote`
 * reads them. A word that could be more than one word (`needsChoice`) is left out: the owner may mean
 * one of the others, and the note editor warns about a duplicate once they pick.
 */
export function alreadyInDeck(
  items: QueuedNote[],
  notes: Note[],
  noteTypes: ReadonlyMap<string, Pick<NoteType, 'fields'>>,
): { note: QueuedNote; deck: string }[] {
  return items.flatMap((note) => {
    if (note.state !== 'ready' || needsChoice(note)) return [];
    const names = queuedFieldNames(note, noteTypes);
    if (!names.length) return [];
    const draft = approvalDraft(note, names, []);
    const other = duplicateOf(notes, draft, names[0]);
    return other ? [{ note, deck: other.deck }] : [];
  });
}

/** The words a list names, as a person would say them: "a", "a and b", "a, b and c". */
const spoken = (words: string[]) => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`);

/**
 * What the queue screen says about the words taken off it because the deck already had them, one line
 * per deck (`deck` as the screen names it).
 */
export function droppedNotice(dropped: readonly { entry: string; deck: string }[]): string[] {
  const byDeck = new Map<string, string[]>();
  for (const d of dropped) {
    const words = byDeck.get(d.deck) ?? [];
    if (!words.includes(d.entry)) byDeck.set(d.deck, [...words, d.entry]);
  }
  return [...byDeck].map(([deck, words]) => words.length === 1
    ? `${words[0]} was already in ${deck}, so it was taken off the queue.`
    : `${spoken(words)} were already in ${deck}, so they were taken off the queue.`);
}

const notes = (n: number) => (n === 1 ? '1 note' : `${n} notes`);

const words = (n: number) => (n === 1 ? '1 word' : `${n} words`);

/**
 * What Today's card says about the queue, or null when it's empty. `held` counts the words added
 * while offline (heldNotes.ts), which the server's queue doesn't have yet.
 */
export function bannerOf(
  queue: NoteQueue | null,
  held: { waiting: number; refused: number } = { waiting: 0, refused: 0 },
  /** The server is down rather than the phone offline: the held words wait for it instead. */
  serverDown = false,
): { tone: 'ready' | 'waiting' | 'failed'; message: string; hint: string } | null {
  const { ready, waiting, failed } = counts(queue?.items ?? []);
  if (ready) return { tone: 'ready', message: `${ready === 1 ? '1 new note' : `${ready} new notes`} written by Claude`, hint: 'Tap to review and add' };
  if (held.refused) return { tone: 'failed', message: `Couldn't send ${words(held.refused)} to Claude`, hint: 'Tap to see why' };
  if (held.waiting) return { tone: 'waiting', message: `${words(held.waiting)} waiting for Claude`, hint: serverDown ? "They'll be sent once your server answers" : "They'll be sent when you're back online" };
  if (waiting) return { tone: 'waiting', message: `Filling in ${notes(waiting)}`, hint: 'Usually ready in a few minutes' };
  if (failed) return { tone: 'failed', message: `Couldn't fill in ${notes(failed)}`, hint: 'Tap to see why and try again' };
  return null;
}
