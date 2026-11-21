import type { Card, Note } from './types';

/** Whether the note is tagged a leech (Anki compares tags without regard to case). */
export function isLeechNote(note: Note): boolean {
  return note.tags.some((t) => t.toLowerCase() === 'leech');
}

/**
 * A leech is let go once it's recovered: every card of the note still studied is a review
 * scheduled this many days out or more (Anki's mature interval). A card forgotten again and again
 * only reaches that by being answered right several times since its last lapse, which is what
 * "recovered" means, and the schedule says so without a count of answers (an imported card has no
 * history here to count). Anki's `leech` tag is never taken off, as Anki never takes it off: a
 * learner's own searches and filtered decks rely on it. Recovery is read from the cards each time
 * instead (`isLiveLeech`), never stored, so a word that lapses again is a leech again at once.
 */
export const LEECH_RECOVERED_DAYS = 21;

/** Whether a card is a review scheduled far enough out to count as recovered. */
function recovered(card: Card): boolean {
  return card.sched.state === 2 && card.sched.scheduledDays >= LEECH_RECOVERED_DAYS;
}

/**
 * Whether a note tagged leech has recovered. `cards` are all of the note's cards. A studied card
 * that's suspended holds it back (a preset that suspends leeches keeps the tag until the card is
 * studied again); a card never studied (a reverse card still new) and a retired one are ignored,
 * since neither says anything about how well the word is known.
 */
export function leechRecovered(note: Note, cards: Card[]): boolean {
  if (!isLeechNote(note)) return false;
  const studied = cards.filter((c) => c.noteId === note.id && !c.retired && c.sched.state !== 0);
  return studied.length > 0 && studied.every((c) => !c.suspended && recovered(c));
}

/**
 * Whether a note is a leech now: tagged one, and not recovered since. What Trouble, Browse's marker,
 * a cram's missed words and Review's chip show; `cards` are the note's cards (others are ignored).
 */
export function isLiveLeech(note: Note, cards: Card[]): boolean {
  return isLeechNote(note) && !leechRecovered(note, cards);
}
