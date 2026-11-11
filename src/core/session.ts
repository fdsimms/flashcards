import { nextCard, type Queue, type StudiedToday } from './queue';
import type { AnkiUndo } from '../anki/writeback';
import type { RatingValue } from './scheduler';
import type { Card, Note } from './types';

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
  /** The rating given, and how long the card was on screen before it, for the session's summary. */
  rating: RatingValue;
  takenMs: number;
  /** Siblings the answer buried (`siblingsToBury`), as they were before: undo puts them back. */
  buried: Card[];
  /** The note as it was, when the answer made the card a leech and tagged it: undo puts it back. */
  leechNote?: Note;
}

/** How far through the session is: answers given over those plus the cards still queued. */
export function sessionProgress(answered: number, remaining: number): number {
  const total = answered + remaining;
  return total > 0 ? answered / total : 0;
}

export interface SessionSummary {
  answered: number;
  /** Answers that were Again. */
  again: number;
  takenMs: number;
}

/** What to say when the session ends, from the answers still standing (an undone one isn't in `history`). */
export function sessionSummary(history: AnswerRecord[]): SessionSummary {
  return {
    answered: history.length,
    again: history.filter((a) => a.rating === 1).length,
    takenMs: history.reduce((sum, a) => sum + a.takenMs, 0),
  };
}

/** How far a card has to be dragged sideways, in points, for letting go to answer it. */
export const SWIPE_DISTANCE = 110;
/** A quick flick (points per millisecond) needs only this much distance. */
const FLICK_VELOCITY = 0.8;
const FLICK_DISTANCE = 40;

/**
 * The rating a sideways drag means when let go: right is Good, left is Again. Null when it's too
 * short to count, or when that rating isn't one of the answer buttons shown, so a swipe never
 * gives an answer the buttons wouldn't.
 */
export function swipeRating(dx: number, vx: number, shown: RatingValue[]): RatingValue | null {
  const far = Math.abs(dx) >= SWIPE_DISTANCE || (Math.abs(dx) >= FLICK_DISTANCE && Math.abs(vx) >= FLICK_VELOCITY && Math.sign(vx) === Math.sign(dx));
  if (!far) return null;
  const rating: RatingValue = dx > 0 ? 3 : 1;
  return shown.includes(rating) ? rating : null;
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
