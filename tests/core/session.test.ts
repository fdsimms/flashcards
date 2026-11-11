import { describe, expect, it } from 'vitest';
import { makeCards } from '../../src/core/cards';
import { bumpStudied, currentCard, sessionProgress, sessionSummary, SWIPE_DISTANCE, swipeRating, type AnswerRecord } from '../../src/core/session';
import { NOW, omniNote } from '../support/fixtures';

describe('bumpStudied', () => {
  it('counts first answers to new cards and answers to reviews, and takes them back on undo', () => {
    let s = new Map();
    s = bumpStudied(s, 'Thai', 0, 1);
    s = bumpStudied(s, 'Thai', 2, 1);
    s = bumpStudied(s, 'Thai', 1, 1); // learning: not limited, not counted
    expect(s.get('Thai')).toEqual({ introduced: 1, reviewed: 1 });
    s = bumpStudied(s, 'Thai', 2, -1);
    expect(s.get('Thai')).toEqual({ introduced: 1, reviewed: 0 });
    expect(bumpStudied(s, 'Thai', 2, -1).get('Thai')).toEqual({ introduced: 1, reviewed: 0 });
  });
  it('leaves the map it was given alone', () => {
    const s = new Map();
    bumpStudied(s, 'Thai', 0, 1);
    expect(s.size).toBe(0);
  });
});

describe('currentCard', () => {
  it('shows the card an undo brought back, else the queue\'s next', () => {
    const [a] = makeCards({ ...omniNote(), id: 'a' }, NOW);
    const [b] = makeCards({ ...omniNote(), id: 'b' }, NOW);
    const q = { due: [], fresh: [a, b] };
    expect(currentCard(q)?.id).toBe(a.id);
    expect(currentCard(q, b.id)?.id).toBe(b.id);
    expect(currentCard(q, 'gone')?.id).toBe(a.id);
  });
});

describe('sessionProgress', () => {
  it('is answers over answers plus what is still queued', () => {
    expect(sessionProgress(0, 10)).toBe(0);
    expect(sessionProgress(5, 5)).toBe(0.5);
    expect(sessionProgress(10, 0)).toBe(1);
  });
  it('is 0 for an empty session, not NaN', () => {
    expect(sessionProgress(0, 0)).toBe(0);
  });
});

describe('sessionSummary', () => {
  const answer = (rating: 1 | 2 | 3 | 4, takenMs: number) => ({ rating, takenMs }) as AnswerRecord;
  it('counts answers, Agains and time', () => {
    expect(sessionSummary([answer(1, 4000), answer(3, 6000), answer(1, 2000)])).toEqual({ answered: 3, again: 2, takenMs: 12000 });
  });
  it('is empty for no answers', () => {
    expect(sessionSummary([])).toEqual({ answered: 0, again: 0, takenMs: 0 });
  });
});

describe('swipeRating', () => {
  const all = [1, 2, 3, 4] as const;
  it('answers Good to the right and Again to the left, once dragged far enough', () => {
    expect(swipeRating(SWIPE_DISTANCE, 0, [...all])).toBe(3);
    expect(swipeRating(-SWIPE_DISTANCE, 0, [...all])).toBe(1);
  });
  it('ignores a short drag', () => {
    expect(swipeRating(SWIPE_DISTANCE - 1, 0, [...all])).toBeNull();
    expect(swipeRating(0, 0, [...all])).toBeNull();
  });
  it('lets a quick flick answer from a shorter distance, but only in the direction it went', () => {
    expect(swipeRating(60, 1.2, [...all])).toBe(3);
    expect(swipeRating(-60, -1.2, [...all])).toBe(1);
    expect(swipeRating(60, -1.2, [...all])).toBeNull();
    expect(swipeRating(20, 1.2, [...all])).toBeNull();
  });
  it('never gives a rating the answer buttons do not show', () => {
    expect(swipeRating(200, 0, [1, 2])).toBeNull();
    expect(swipeRating(-200, 0, [3, 4])).toBeNull();
  });
});
