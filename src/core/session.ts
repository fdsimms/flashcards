import { nextCard, type Queue, type StudiedToday } from './queue';
import type { AnkiUndo } from '../anki/writeback';
import type { Card } from './types';

/**
 * Bookkeeping for one review session, kept out of the screen so it can be tested: today's counts
 * as answers are given and taken back, and which card to show after an undo.
 */

/**
 * Today's counts after an answer (`delta` 1) or its undo (-1) on a card in `deck` that was in
 * `stateBefore`. Only first answers to New cards and answers to Review cards count toward limits.
 */
export function bumpStudied(
  studied: Map<string, StudiedToday>,
  deck: string,
  stateBefore: number,
  delta: 1 | -1,
): Map<string, StudiedToday> {
  if (stateBefore !== 0 && stateBefore !== 2) return studied;
  const out = new Map(studied);
  const s = out.get(deck) ?? { introduced: 0, reviewed: 0 };
  out.set(deck, {
    introduced: Math.max(0, s.introduced + (stateBefore === 0 ? delta : 0)),
    reviewed: Math.max(0, s.reviewed + (stateBefore === 2 ? delta : 0)),
  });
  return out;
}

/** One answer, enough to take it back. */
export interface AnswerRecord {
  /** The card as it was before the answer. */
  before: Card;
  /** The review log row the answer wrote. */
  reviewId: number;
  /** The card's own deck (not the one being studied, which may be its parent). */
  deck: string;
  /** What undoes the answer in the kept Anki collection, when the card is from one. */
  anki?: AnkiUndo;
  /** Siblings the answer buried (`siblingsToBury`), as they were before: undo puts them back. */
  buried: Card[];
}

/**
 * The card to show: the one just brought back by an undo when it's in the queue, as Anki does,
 * else the queue's next.
 */
export function currentCard(queue: Queue, preferId?: string): Card | undefined {
  if (preferId) {
    const preferred = queue.due.find((c) => c.id === preferId) ?? queue.fresh.find((c) => c.id === preferId);
    if (preferred) return preferred;
  }
  return nextCard(queue);
}
