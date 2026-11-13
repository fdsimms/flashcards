import { calendarStart, type Answer } from './stats';
import { cardHomeDeck, isInDeck } from './deckTree';
import type { Card, Note } from './types';

/**
 * Trouble cards: the cards being studied that are forgotten most, for the screen of the same name
 * (opened from Stats). One row per card rather than per note, since one direction of a word is
 * usually the hard one. Pure: the screen gathers the inputs.
 *
 * - **Most missed** reads the card's own lapse and review counts (Anki's `lapses` and `reps`, kept
 *   in `Card.sched`), so it covers the card's whole history, answers given in Anki included.
 * - **Missed lately** counts reviews answered Again over the last `RECENT_DAYS` study days, from
 *   the same answers Stats counts (`answersFrom`). Again on a relearning step isn't another miss,
 *   as a lapse isn't counted again for it in Anki either.
 *
 * Suspended, retired and new cards are left out: there's nothing to do about a card not being
 * studied.
 */

export type TroubleMode = 'most' | 'lately';

/** How many study days "Missed lately" looks back. */
export const RECENT_DAYS = 30;

export interface TroubleRow {
  card: Card;
  note: Note;
  /** Times forgotten: all-time lapses, or Again on a review in the last `RECENT_DAYS` study days. */
  misses: number;
  /** Answers it's out of: all-time reviews, or reviews in the window. */
  answers: number;
  /** The note carries Anki's `leech` tag. */
  leech: boolean;
}

/** Whether the note is tagged a leech (Anki compares tags without regard to case). */
export function isLeechNote(note: Note): boolean {
  return note.tags.some((t) => t.toLowerCase() === 'leech');
}

export function troubleCards(input: {
  cards: Card[];
  notes: Note[];
  answers: Answer[];
  /** The deck to look in, with its subdecks; null for every deck. */
  deck: string | null;
  mode: TroubleMode;
  now: Date;
  dayStartsAtHour: number;
}): TroubleRow[] {
  const { cards, deck, mode } = input;
  const noteById = new Map(input.notes.map((n) => [n.id, n]));
  const studied = new Map<string, { card: Card; note: Note }>();
  for (const card of cards) {
    if (card.suspended || card.retired || card.sched.state === 0) continue;
    const note = noteById.get(card.noteId);
    if (!note) continue;
    if (deck !== null && !isInDeck(cardHomeDeck(card, note.deck), deck)) continue;
    studied.set(card.id, { card, note });
  }

  const rows: TroubleRow[] = [];
  if (mode === 'most') {
    for (const { card, note } of studied.values()) {
      if (card.sched.lapses < 1) continue;
      rows.push({ card, note, misses: card.sched.lapses, answers: card.sched.reps, leech: isLeechNote(note) });
    }
  } else {
    const since = calendarStart(input.now, input.dayStartsAtHour, RECENT_DAYS).getTime();
    const tally = new Map<string, { misses: number; answers: number }>();
    for (const a of input.answers) {
      if (a.kind !== 'review' || a.preview || a.at.getTime() < since || !studied.has(a.cardId)) continue;
      const t = tally.get(a.cardId) ?? { misses: 0, answers: 0 };
      t.answers += 1;
      if (a.rating === 1) t.misses += 1;
      tally.set(a.cardId, t);
    }
    for (const [id, t] of tally) {
      if (t.misses < 1) continue;
      const { card, note } = studied.get(id)!;
      rows.push({ card, note, ...t, leech: isLeechNote(note) });
    }
  }
  // Most misses first; of two with as many, the one missed more often for its answers; then a
  // fixed order, so the list doesn't shuffle between loads.
  return rows.sort((a, b) => b.misses - a.misses
    || b.misses / Math.max(1, b.answers) - a.misses / Math.max(1, a.answers)
    || a.card.id.localeCompare(b.card.id));
}
