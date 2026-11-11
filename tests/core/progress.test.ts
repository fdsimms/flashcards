import { describe, expect, it } from 'vitest';
import { makeCards } from '../../src/core/cards';
import { GURU_INTERVAL_DAYS, isInProgress, parseGateCap } from '../../src/core/progress';
import { review } from '../../src/core/scheduler';
import type { Card } from '../../src/core/types';
import { NOW, omniNote } from '../support/fixtures';

const withSched = (c: Card, over: Partial<Card['sched']>): Card => ({ ...c, sched: { ...c.sched, ...over } });

describe('isInProgress', () => {
  const [card] = makeCards(omniNote(), NOW);
  it("doesn't count a new card until it's met", () => {
    expect(isInProgress(card)).toBe(false);
  });
  it('counts learning and relearning cards, and reviews under a week out', () => {
    expect(isInProgress(withSched(card, { state: 1 }))).toBe(true);
    expect(isInProgress(withSched(card, { state: 3, scheduledDays: 30 }))).toBe(true);
    expect(isInProgress(withSched(card, { state: 2, scheduledDays: GURU_INTERVAL_DAYS - 1 }))).toBe(true);
  });
  it('lets a card go once its next review is a week or more away', () => {
    expect(isInProgress(withSched(card, { state: 2, scheduledDays: GURU_INTERVAL_DAYS }))).toBe(false);
  });
  it('counts a forgotten card again: Again on a long review sends it back to relearning', () => {
    const mature = withSched(card, { state: 2, scheduledDays: 40, stability: 40, difficulty: 5, reps: 6, lastReview: new Date(2026, 9, 1).toISOString(), due: NOW.toISOString() });
    expect(isInProgress(mature)).toBe(false);
    expect(isInProgress({ ...mature, sched: review(mature.sched, 1, NOW).sched })).toBe(true);
  });
});

describe('parseGateCap', () => {
  it('takes a whole number from 1 to 5000 and says why anything else is refused', () => {
    expect(parseGateCap(' 120 ')).toEqual({ cap: 120 });
    expect(parseGateCap('12.5')).toEqual({ error: 'Enter a whole number, for example 100.' });
    expect(parseGateCap('0')).toHaveProperty('error');
    expect(parseGateCap('9000')).toHaveProperty('error');
  });
});
