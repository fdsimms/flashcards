// The note queue, app side: words typed in Quick add, filled in by Claude on Read & Listen's server, then
// reviewed here. Saving a note in the note editor is the approval step: nothing in this file (or the
// screens that use it) creates a note or touches a card. Pure, so it's tested.
import type { Language, NoteQueue, QueuedNote } from './api';

/**
 * The decks Quick add can queue words for: each Read & Listen language's deck (`decks`, from its
 * settings; missing from a server older than the deck setting) that is in the collection
 * (`deckNames`). A language never studied has no deck to add to. The deck list offers Quick add only
 * when this has one, and the Quick add screen chooses from it, so the two can't disagree. The
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

/** The most words one Quick add queues; the server refuses more. */
export const MAX_WORDS = 50;

/**
 * What Quick add's box holds, as words to queue: one per line, with the owner's own meaning after a
 * spaced dash or a tab ("bouder - to sulk"). Blank lines are skipped, and a line repeating an earlier
 * one is counted in `repeated` so the screen can say it was ignored.
 */
export function parseWords(text: string): { entries: { entry: string; meaning: string }[]; repeated: number } {
  const seen = new Set<string>();
  const entries: { entry: string; meaning: string }[] = [];
  let repeated = 0;
  for (const raw of text.split(/\r?\n/)) {
    const [first, ...rest] = raw.trim().split(/\s+[-–—]\s+|\t+/);
    const entry = first.trim();
    if (!entry) continue;
    if (seen.has(entry)) { repeated++; continue; }
    seen.add(entry);
    entries.push({ entry, meaning: rest.join(' - ').trim() });
  }
  return { entries, repeated };
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

/** The new note a ready word starts as, for the note editor: the fields Claude wrote under the Entry. */
export function reviewTarget(note: QueuedNote): { deck: string; model: string; fields: Record<string, string> } {
  return { deck: note.deck, model: 'Omnilanguage', fields: { Entry: note.entry, ...note.fields } };
}

const notes = (n: number) => (n === 1 ? '1 note' : `${n} notes`);

/** What the deck list's card says about the queue, or null when it's empty. */
export function bannerOf(queue: NoteQueue | null): { tone: 'ready' | 'waiting' | 'failed'; message: string; hint: string } | null {
  if (!queue) return null;
  const { ready, waiting, failed } = counts(queue.items);
  if (ready) return { tone: 'ready', message: `${notes(ready)} ready to review`, hint: 'Tap to start' };
  if (waiting) return { tone: 'waiting', message: `Filling in ${notes(waiting)}`, hint: 'Usually ready in a few minutes' };
  if (failed) return { tone: 'failed', message: `Couldn't fill in ${notes(failed)}`, hint: 'Tap to see why and try again' };
  return null;
}
