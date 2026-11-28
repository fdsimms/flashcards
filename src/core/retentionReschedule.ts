import { fuzzFactor, minimumReviewFuzzInterval, rescheduleBalancedInterval, withReviewFuzz, type RescheduleBalance } from './ankiFuzz';
import { studyDayAfter } from './reschedule';
import { daysSinceLastReview, rawInterval } from './scheduler';
import type { Card } from './types';

/**
 * Anki's "Reschedule cards on change" for a change of desired retention (rslib's
 * scheduler/fsrs/memory_state.rs, `update_memory_state` with `reschedule`): a review card's next
 * interval is worked out again from its memory state at the new retention, fuzzed or placed by the
 * load balancer as an answer's would be, and counted from its last answer, so a card can come out
 * due today or overdue. A card in (re)learning, a suspended card and one never answered keep their
 * dates. The kept collection's cards are rescheduled in src/anki/retentionWrites.ts; a card that
 * lives in Franki only is rescheduled here (`rescheduleFrankiCard`).
 *
 * Anki works the memory state out again from the review log first. With the FSRS weights
 * unchanged, which a retention change leaves them, that is the state the card already holds,
 * whether Anki or Franki wrote it, so this uses the stored one.
 */

/** A review log row as the rescheduler reads it. */
export interface RevlogEntryLite {
  id: number;
  ease: number;
  type: number;
  factor: number;
  lastIvl: number;
}

/** A card's last answer: when (unix seconds), and the interval it had before it (`previous_interval`). */
export interface LastAnswer { at: number; previousInterval: number }

/**
 * The last answer that counts, as `get_last_revlog_info` reads a card's review log (oldest first):
 * a rating that isn't a preview in a filtered deck, and nothing before the latest Forget. The
 * previous interval is the one the answer started from, when that was in days and the answer
 * wasn't Again; else 0.
 */
export function lastAnswerOf(entries: readonly RevlogEntryLite[]): LastAnswer | undefined {
  let last: LastAnswer | undefined;
  for (const e of [...entries].sort((a, b) => a.id - b.id)) {
    const cramming = e.type === 3 && e.factor === 0;
    if (e.ease > 0 && !cramming) last = { at: Math.floor(e.id / 1000), previousInterval: e.lastIvl >= 0 && e.ease > 1 ? e.lastIvl : 0 };
    else if (e.type === 4 && e.factor === 0) last = undefined; // Forget (a Manual row with no ease factor)
  }
  return last;
}

/** How many real answers count toward the card's memory state: the ones after its latest Forget. */
export function answersSinceReset(entries: readonly RevlogEntryLite[]): number {
  let n = 0;
  for (const e of [...entries].sort((a, b) => a.id - b.id)) {
    if (e.ease > 0 && !(e.type === 3 && e.factor === 0)) n++;
    else if (e.type === 4 && e.factor === 0) n = 0;
  }
  return n;
}

/**
 * The days a card is rescheduled to, counted from its last answer: FSRS's interval at the new
 * retention, at least past the previous interval as an answer's is, then placed by the load
 * balancer (with a seed and `balance`) or fuzzed with the card's seed, else rounded.
 */
export function rescheduledInterval(o: {
  stability: number;
  desiredRetention: number;
  weights: number[];
  maxInterval: number;
  previousInterval: number;
  daysElapsed: number;
  /** Anki's fuzz seed for a reschedule: the card's id plus its reps less one (`get_fuzz_seed(card, true)`). */
  seed?: bigint;
  balance?: Omit<RescheduleBalance, 'seed'>;
}): number {
  const iv = rawInterval(o.stability, o.desiredRetention, o.weights);
  const min = Math.max(minimumReviewFuzzInterval(iv, o.previousInterval, o.maxInterval), 1);
  if (o.seed !== undefined && o.balance) {
    const placed = rescheduleBalancedInterval(iv, min, o.maxInterval, o.daysElapsed, { ...o.balance, seed: o.seed });
    if (placed !== undefined) return placed;
  }
  return withReviewFuzz(o.seed !== undefined ? fuzzFactor(o.seed) : undefined, iv, min, o.maxInterval);
}

/** Whether rescheduling moves this Franki card: a review, not suspended, answered at least once. */
export function frankiCardReschedules(card: Card): boolean {
  return card.sched.state === 2 && !card.suspended && !card.retired && !!card.sched.lastReview;
}

/**
 * A card that lives in Franki only, rescheduled for a new retention, or undefined when it stays as
 * it is. Without an Anki id it has no fuzz seed, so its interval is rounded, as Anki's would be, and
 * the interval before its last answer isn't kept, so only the shortest interval of a day applies.
 */
export function rescheduleFrankiCard(card: Card, o: { desiredRetention: number; weights: number[]; maxInterval: number; now: Date; dayStartsAtHour: number }): Card | undefined {
  if (!frankiCardReschedules(card)) return undefined;
  const elapsed = daysSinceLastReview(new Date(card.sched.lastReview!), o.now, o.dayStartsAtHour);
  const interval = rescheduledInterval({
    stability: card.sched.stability, desiredRetention: o.desiredRetention, weights: o.weights, maxInterval: o.maxInterval,
    previousInterval: 0, daysElapsed: elapsed,
  });
  const due = studyDayAfter(o.now, interval - elapsed, o.dayStartsAtHour);
  return { ...card, sched: { ...card.sched, due: due.toISOString(), scheduledDays: interval } };
}
