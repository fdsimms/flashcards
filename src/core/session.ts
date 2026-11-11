import { nextCard, type Queue, type StudiedToday } from './queue';
import type { AnkiUndo } from '../anki/writeback';
import type { Card } from './types';

/**
 * Bookkeeping for one review session, kept out of the screen so it can be tested: today's counts
 * as answers are given and taken back, and which card to show after an undo.
 */

/**
 * Today's counts after an answer (`delta` 1) or its undo (-1) on a card in `deck`, by what the
 * answer used of the limits (`studiedKind` of the card before it): the same rule `studiedToday`
 * counts by, so an undo takes back exactly what the answer added.
 */
export function bumpStudied(
  studied: Map<string, StudiedToday>,
  deck: string,
  kind: 'new' | 'review' | null,
  delta: 1 | -1,
): Map<string, StudiedToday> {
  if (!kind) return studied;
  const out = new Map(studied);
  const s = out.get(deck) ?? { introduced: 0, reviewed: 0 };
  out.set(deck, {
    introduced: Math.max(0, s.introduced + (kind === 'new' ? delta : 0)),
    reviewed: Math.max(0, s.reviewed + (kind === 'review' ? delta : 0)),
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
    const preferred = queue.order.find((c) => c.id === preferId);
    if (preferred) return preferred;
  }
  return nextCard(queue);
}
