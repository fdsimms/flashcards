import { describe, expect, it } from 'vitest';
import { makeCards } from '../../src/core/cards';
import { studiedKind } from '../../src/core/queue';
import { answerTimeMs, bumpStudied, currentCard, sessionProgress, sessionSummary, SWIPE_DISTANCE, swipeRating, upNext, type AnswerRecord } from '../../src/core/session';
import { NOW, omniNote } from '../support/fixtures';

describe('answerTimeMs', () => {
  it("caps an answer's time at the preset's maximum answer seconds, a minute without one", () => {
    expect(answerTimeMs(95_000, undefined)).toBe(60_000);
    expect(answerTimeMs(95_000, { maxAnswerSecs: 120 })).toBe(95_000);
    expect(answerTimeMs(95_000, { maxAnswerSecs: 30 })).toBe(30_000);
    expect(answerTimeMs(4_000, { maxAnswerSecs: 30 })).toBe(4_000);
    // A clock that moved back records nothing rather than a negative time.
    expect(answerTimeMs(-500, undefined)).toBe(0);
  });
});

describe('bumpStudied', () => {
  it('counts first answers to new cards and answers to reviews, and takes them back on undo', () => {
    let s = new Map();
    s = bumpStudied(s, 'Thai', 'new', 1);
    s = bumpStudied(s, 'Thai', 'review', 1);
    s = bumpStudied(s, 'Thai', null, 1); // a step within the day: not limited, not counted
    expect(s.get('Thai')).toEqual({ introduced: 1, reviewed: 1 });
    s = bumpStudied(s, 'Thai', 'review', -1);
    expect(s.get('Thai')).toEqual({ introduced: 1, reviewed: 0 });
    expect(bumpStudied(s, 'Thai', 'review', -1).get('Thai')).toEqual({ introduced: 1, reviewed: 0 });
  });
  it("says what an answer uses: a new card's first, a review, or a day-long learning step", () => {
    const [card] = makeCards(omniNote(), NOW);
    const at = (d: number) => new Date(2026, 10, d, 9).toISOString();
    expect(studiedKind(card, 4)).toBe('new');
    expect(studiedKind({ ...card, sched: { ...card.sched, state: 2 } }, 4)).toBe('review');
    expect(studiedKind({ ...card, sched: { ...card.sched, state: 1, due: at(11), lastReview: at(10) } }, 4)).toBe('review');
    expect(studiedKind({ ...card, sched: { ...card.sched, state: 1, due: at(11), lastReview: at(11) } }, 4)).toBeNull();
  });
  it('leaves the map it was given alone', () => {
    const s = new Map();
    bumpStudied(s, 'Thai', 'new', 1);
    expect(s.size).toBe(0);
  });
});

describe('currentCard', () => {
  it('shows the card an undo brought back, else the queue\'s next', () => {
    const [a] = makeCards({ ...omniNote(), id: 'a' }, NOW);
    const [b] = makeCards({ ...omniNote(), id: 'b' }, NOW);
    const q = { due: [], fresh: [a, b], order: [a, b] };
    expect(currentCard(q)?.id).toBe(a.id);
    expect(currentCard(q, b.id)?.id).toBe(b.id);
    expect(currentCard(q, 'gone')?.id).toBe(a.id);
  });
});

describe('upNext', () => {
  it("guesses the queue's next card besides the one showing, whichever place that one has", () => {
    const [a] = makeCards({ ...omniNote(), id: 'a' }, NOW);
    const [b] = makeCards({ ...omniNote(), id: 'b' }, NOW);
    const [c] = makeCards({ ...omniNote(), id: 'c' }, NOW);
    const q = { due: [], fresh: [a, b, c], order: [a, b, c] };
    expect(upNext(q, a)?.id).toBe(b.id);
    // An undo shows a card from further down: the one at the front still comes next.
    expect(upNext(q, b)?.id).toBe(a.id);
    expect(upNext({ due: [], fresh: [a], order: [a] }, a)).toBeUndefined();
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
