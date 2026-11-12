import { describe, expect, it } from 'vitest';
import { makeCards } from '../../src/core/cards';
import { paramsForDeck, previewIntervals, review } from '../../src/core/scheduler';
import type { DeckParams } from '../../src/core/types';
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
    // studiedToday counts a card as introduced by a log with state 0, so this is load-bearing.
    const [card] = makeCards(omniNote(), NOW);
    const first = review(card.sched, 3, NOW);
    expect(first.log.state).toBe(0);
    expect(review(first.sched, 3, NOW).log.state).not.toBe(0);
  });

  it("uses a deck's retention: lower retention spaces a review further out", () => {
    const [card] = makeCards(omniNote(), NOW);
    const learned = review(review(card.sched, 3, NOW).sched, 3, new Date(2026, 10, 12, 12)).sched;
    const at = new Date(2026, 10, 20, 12);
    const strict = review(learned, 3, at, { weights: [], desiredRetention: 0.95, maxInterval: 36500 });
    const loose = review(learned, 3, at, { weights: [], desiredRetention: 0.8, maxInterval: 36500 });
    expect(loose.sched.scheduledDays).toBeGreaterThan(strict.sched.scheduledDays);
  });
  it('accepts FSRS-5 (19) and FSRS-6 (21) weights', () => {
    const [card] = makeCards(omniNote(), NOW);
    const w19 = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];
    const w21 = [0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542];
    for (const weights of [w19, w21]) {
      expect(review(card.sched, 4, NOW, { weights, desiredRetention: 0.9, maxInterval: 36500 }).sched.stability).toBeGreaterThan(0);
    }
  });
  it("falls back to the nearest ancestor deck's settings", () => {
    const thai: DeckParams = { weights: [], desiredRetention: 0.9, maxInterval: 36500 };
    const langs: DeckParams = { weights: [], desiredRetention: 0.8, maxInterval: 36500 };
    const all = new Map([['Languages::Thai', thai], ['Languages', langs]]);
    expect(paramsForDeck('Languages::Thai::Consonants', all)).toBe(thai);
    expect(paramsForDeck('Languages::Polish', all)).toBe(langs);
    expect(paramsForDeck('Trivia', all)).toBeUndefined();
  });
  it('schedules from countFrom when a lookalike was seen since the last review: a smaller step than the whole interval', () => {
    const [card] = makeCards(omniNote(), NOW);
    let s = review(card.sched, 3, NOW).sched;
    s = review(s, 3, new Date(2026, 10, 12, 12)).sched;
    s = review(s, 3, new Date(2026, 10, 20, 12)).sched;
    const at = new Date(2026, 11, 20, 12);
    const plain = review(s, 3, at).sched;
    const reminded = review(s, 3, at, undefined, new Date(2026, 11, 19, 12)).sched;
    expect(reminded.stability).toBeLessThan(plain.stability);
    expect(new Date(reminded.due).getTime()).toBeLessThan(new Date(plain.due).getTime());
    // The card still records the real review time as its last review.
    expect(reminded.lastReview).toBe(at.toISOString());
    expect(previewIntervals(s, at, undefined, new Date(2026, 11, 19, 12))[3]).not.toBe(previewIntervals(s, at)[3]);
  });
  it('ignores a countFrom before the last review', () => {
    const [card] = makeCards(omniNote(), NOW);
    const s = review(card.sched, 3, NOW).sched;
    const at = new Date(2026, 10, 14, 12);
    expect(review(s, 3, at, undefined, new Date(2026, 10, 1)).sched.stability).toBe(review(s, 3, at).sched.stability);
  });
});
