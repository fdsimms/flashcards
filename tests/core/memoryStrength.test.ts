import { describe, expect, it } from 'vitest';
import { makeCards } from '../../src/core/cards';
import { FRAGILE_BELOW, fragilePercent } from '../../src/core/memoryStrength';
import type { Card } from '../../src/core/types';
import { NOW, omniNote } from '../support/fixtures';

const base = makeCards(omniNote(), NOW)[0];
const DAY = 86_400_000;
const reviewed = (daysAgo: number, over: Partial<Card['sched']> = {}): Card => ({
  ...base,
  sched: { ...base.sched, state: 2, stability: 10, reps: 3, lastReview: new Date(NOW.getTime() - daysAgo * DAY).toISOString(), ...over },
});

describe('fragile review cards', () => {
  it('says nothing for a card recalled well', () => {
    expect(fragilePercent(reviewed(1), NOW, [])).toBeUndefined();
  });

  it('gives the percent for a long overdue card, under the threshold', () => {
    const p = fragilePercent(reviewed(400), NOW, []);
    expect(p).toBeDefined();
    expect(p!).toBeLessThan(FRAGILE_BELOW * 100);
  });

  it('only speaks of Review cards: a new or learning card has no memory to read', () => {
    expect(fragilePercent(reviewed(400, { state: 0 }), NOW, [])).toBeUndefined();
    expect(fragilePercent(reviewed(400, { state: 1 }), NOW, [])).toBeUndefined();
  });

  it('says nothing for a card never reviewed', () => {
    expect(fragilePercent(reviewed(400, { lastReview: null }), NOW, [])).toBeUndefined();
  });
});
