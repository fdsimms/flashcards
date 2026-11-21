// The note queue, app side: words typed in Quick add (src/ui/QuickAdd.tsx), filled in by Claude on Read & Listen's server, then
// reviewed here. Saving a note in the note editor is the approval step: nothing in this file (or the
// screens that use it) creates a note or touches a card. Pure, so it's tested.
import { bareNoun, bareVerb, genderOf } from '../core/gender';
import { editTextToField } from '../core/noteEditing';
import type { WordChoice } from '../core/quickAdd';
import type { Language, NoteQueue, QueuedNote } from './api';

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

/** How many queued words are in each state. */
export function counts(items: QueuedNote[]): { ready: number; waiting: number; failed: number } {
  return {
    ready: items.filter((n) => n.state === 'ready').length,
    waiting: items.filter((n) => n.state === 'waiting').length,
    failed: items.filter((n) => n.state === 'failed').length,
  };
}

export const firstReady = (items: QueuedNote[]): QueuedNote | undefined => items.find((n) => n.state === 'ready');

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
  const target = { deck: note.deck, model: 'Omnilanguage', fields, ...(part ? { tags: [part] } : {}) };
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
