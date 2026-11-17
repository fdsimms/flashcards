import { retrievability } from './order';
import type { Card } from './types';

/**
 * How shaky a review card is, for a reminder on its answer side. Read from the card's FSRS schedule
 * each time and never stored; nothing in the scheduler or the queue reads it, so it can't change a
 * rating, an interval or what's offered. Pure, so it's tested.
 */

/** A review card is called fragile when its chance of being recalled now is under this. */
export const FRAGILE_BELOW = 0.7;

/** The card's chance of recall now, as a whole percent, when it's a Review card under `FRAGILE_BELOW`; otherwise undefined. */
export function fragilePercent(card: Card, now: Date, weights: number[]): number | undefined {
  if (card.sched.state !== 2) return undefined;
  const r = retrievability(card, now, weights);
  return r !== undefined && r < FRAGILE_BELOW ? Math.round(r * 100) : undefined;
}
