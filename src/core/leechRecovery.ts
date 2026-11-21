import type { Card } from './types';
import { isLeechNote } from './trouble';
import type { Note } from './types';

/**
 * A leech is let go once it's recovered: every card of the note still studied is a review
 * scheduled this many days out or more (Anki's mature interval). A card forgotten again and again
 * only reaches that by being answered right several times since its last lapse, which is what
 * "recovered" means, and the schedule says so without a count of answers (an imported card has no
 * history here to count). Anki itself never removes the tag; Franki does because its Leeches
 * filter, Trouble and cram all read it as a live signal.
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

/** The tags without `leech` (compared without regard to case, as Anki does). */
export function withoutLeechTag(tags: string[]): string[] {
  return tags.filter((t) => t.toLowerCase() !== 'leech');
}
