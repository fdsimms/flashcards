import { describe, expect, it } from 'vitest';
import { makeCards } from '../../src/core/cards';
import { previewIntervals, review } from '../../src/core/scheduler';
import { NOW, omniNote } from '../support/fixtures';

describe('scheduler', () => {
  it('moves a new card forward and spaces Good further than Again', () => {
    const [card] = makeCards(omniNote(), NOW);
    const good = review(card.sched, 3, NOW);
    const again = review(card.sched, 1, NOW);
    expect(good.sched.reps).toBe(1);
    expect(new Date(good.sched.due).getTime()).toBeGreaterThan(new Date(again.sched.due).getTime());
    expect(good.log.rating).toBe(3);
    const preview = previewIntervals(card.sched, NOW);
    expect(Object.keys(preview)).toHaveLength(4);
  });
  it('logs the state the card was in before the answer', () => {
    // newIntroducedToday counts a card as introduced by a log with state 0, so this is load-bearing.
    const [card] = makeCards(omniNote(), NOW);
    const first = review(card.sched, 3, NOW);
    expect(first.log.state).toBe(0);
    expect(review(first.sched, 3, NOW).log.state).not.toBe(0);
  });
});
