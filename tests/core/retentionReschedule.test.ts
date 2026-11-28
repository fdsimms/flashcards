import { describe, expect, it } from 'vitest';
import { answersSinceReset, frankiCardReschedules, lastAnswerOf, rescheduledInterval, rescheduleFrankiCard } from '../../src/core/retentionReschedule';
import { rawInterval } from '../../src/core/scheduler';
import type { Card } from '../../src/core/types';

const at = (secs: number) => secs * 1000;

describe('lastAnswerOf, as Anki reads a card review log', () => {
  it('takes the latest rating, with the interval it started from', () => {
    expect(lastAnswerOf([
      { id: at(100), ease: 3, type: 0, factor: 0, lastIvl: -600 },
      { id: at(200), ease: 3, type: 1, factor: 2500, lastIvl: 4 },
    ])).toEqual({ at: 200, previousInterval: 4 });
  });
  it('skips Set Due Date and previews, and has no previous interval after Again or a learning step', () => {
    const log = [
      { id: at(100), ease: 1, type: 1, factor: 2500, lastIvl: 10 },
      { id: at(150), ease: 0, type: 4, factor: 2500, lastIvl: 10 }, // Set Due Date
      { id: at(160), ease: 3, type: 3, factor: 0, lastIvl: 1 }, // a preview in a filtered deck
    ];
    expect(lastAnswerOf(log)).toEqual({ at: 100, previousInterval: 0 });
    expect(lastAnswerOf([{ id: at(100), ease: 3, type: 0, factor: 0, lastIvl: -60 }])).toEqual({ at: 100, previousInterval: 0 });
  });
  it('forgets everything before a Forget', () => {
    const log = [
      { id: at(100), ease: 3, type: 1, factor: 2500, lastIvl: 4 },
      { id: at(200), ease: 0, type: 4, factor: 0, lastIvl: 10 }, // Forget
    ];
    expect(lastAnswerOf(log)).toBeUndefined();
    expect(answersSinceReset([...log, { id: at(300), ease: 3, type: 0, factor: 0, lastIvl: 0 }])).toBe(1);
    expect(answersSinceReset(log.slice(0, 1))).toBe(1);
  });
});

describe('rescheduledInterval', () => {
  it('rounds the new retention interval without a seed, and keeps past the previous one', () => {
    const raw = rawInterval(30, 0.8, []);
    expect(rescheduledInterval({ stability: 30, desiredRetention: 0.8, weights: [], maxInterval: 36500, previousInterval: 0, daysElapsed: 1 })).toBe(Math.round(raw));
    // A previous interval longer than FSRS's new one, but inside its fuzz range, is kept.
    const longer = Math.round(raw) + 1;
    expect(rescheduledInterval({ stability: 30, desiredRetention: 0.8, weights: [], maxInterval: 36500, previousInterval: longer, daysElapsed: 1 })).toBe(longer);
  });
  it('fuzzes within the maximum interval', () => {
    const o = { stability: 900, desiredRetention: 0.7, weights: [], maxInterval: 100, previousInterval: 0, daysElapsed: 0 };
    expect(rescheduledInterval(o)).toBe(100);
    for (const seed of [1n, 5n, 99n]) {
      const days = rescheduledInterval({ ...o, seed });
      expect(days).toBeLessThanOrEqual(100);
      expect(days).toBeGreaterThanOrEqual(93);
    }
  });
});

const NOW = new Date(2026, 10, 20, 12);
function review(over: Partial<Card['sched']> = {}, card: Partial<Card> = {}): Card {
  return {
    id: 'n1:forward', noteId: 'n1', kind: 'forward', suspended: false, retired: false,
    sched: { due: new Date(2026, 10, 25, 4).toISOString(), stability: 30, difficulty: 5, elapsedDays: 0, scheduledDays: 10, learningSteps: 0, reps: 3, lapses: 0, state: 2, lastReview: new Date(2026, 10, 15, 9).toISOString(), ...over },
    ...card,
  } as Card;
}

describe('rescheduleFrankiCard', () => {
  it('moves a review to the new interval, counted from its last answer', () => {
    const moved = rescheduleFrankiCard(review(), { desiredRetention: 0.8, weights: [], maxInterval: 36500, now: NOW, dayStartsAtHour: 4 })!;
    const days = Math.round(rawInterval(30, 0.8, []));
    expect(moved.sched.scheduledDays).toBe(days);
    // Answered on the 15th: due that many study days after it, at the day's start.
    expect(new Date(moved.sched.due)).toEqual(new Date(2026, 10, 15 + days, 4));
    expect(moved.sched.stability).toBe(30);
  });
  it('leaves learning, suspended and never-answered cards as they are', () => {
    const o = { desiredRetention: 0.8, weights: [], maxInterval: 36500, now: NOW, dayStartsAtHour: 4 };
    expect(rescheduleFrankiCard(review({ state: 1 }), o)).toBeUndefined();
    expect(rescheduleFrankiCard(review({}, { suspended: true }), o)).toBeUndefined();
    expect(rescheduleFrankiCard(review({ lastReview: null }), o)).toBeUndefined();
    expect(frankiCardReschedules(review())).toBe(true);
  });
});
