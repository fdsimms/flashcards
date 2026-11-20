import { describe, expect, it } from 'vitest';
import { makeCards } from '../../src/core/cards';
import { mix } from '../../src/core/order';
import { studiedKind, type Queue } from '../../src/core/queue';
import { answerTimeMs, bumpStudied, currentCard, keepSessionOrder, sessionProgress, sessionSummary, SWIPE_DISTANCE, swipeRating, upNext, type AnswerRecord } from '../../src/core/session';
import type { Card } from '../../src/core/types';
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
    const q = { due: [], fresh: [a, b], order: [a, b], main: [a, b] };
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
    const q = { due: [], fresh: [a, b, c], order: [a, b, c], main: [a, b, c] };
    expect(upNext(q, a)?.id).toBe(b.id);
    // An undo shows a card from further down: the one at the front still comes next.
    expect(upNext(q, b)?.id).toBe(a.id);
    expect(upNext({ due: [], fresh: [a], order: [a], main: [a] }, a)).toBeUndefined();
    // A card the answer leaves out (a sibling it buries, a lookalike it holds back) won't come next.
    expect(upNext(q, a, (card) => card.id === b.id)?.id).toBe(c.id);
    expect(upNext(q, a, (card) => card.id !== a.id)).toBeUndefined();
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

describe('keepSessionOrder', () => {
  const card = (id: string, state: 0 | 2 = 2): Card => {
    const [c] = makeCards({ ...omniNote(), id }, NOW);
    return { ...c, id, sched: { ...c.sched, state } };
  };
  /** A queue as `treeQueue` builds one: learning due now, the mixed stretch, learning ahead. */
  const queueOf = (learnNow: Card[], reviews: Card[], fresh: Card[], learnAhead: Card[] = []): Queue => {
    const main = mix(reviews, fresh, 0);
    return { due: [...learnNow, ...reviews], fresh, order: [...learnNow, ...main, ...learnAhead], main };
  };
  const ids = (cards: Card[]) => cards.map((c) => c.id);

  it('brings the first new card up after about a review in fifteen, not once the reviews run low', () => {
    const reviews = Array.from({ length: 150 }, (_, i) => card(`r${i}`));
    const fresh = Array.from({ length: 10 }, (_, i) => card(`n${i}`, 0));
    // What Review does: rebuild after every answer, then answer the card on top.
    let shown = queueOf([], reviews, fresh);
    const answered: string[] = [];
    while (shown.order.length) {
      const top = shown.order[0];
      answered.push(top.id);
      const rest = (cards: Card[]) => cards.filter((c) => !answered.includes(c.id));
      shown = keepSessionOrder(shown, queueOf([], rest(reviews), rest(fresh)));
    }
    expect(answered).toHaveLength(160);
    expect(answered.findIndex((id) => id.startsWith('n'))).toBeLessThan(15);
    expect(answered.filter((id) => id.startsWith('n'))).toHaveLength(10);
    // Without it, the same loop gets its first new card at answer 142.
    let bare = queueOf([], reviews, fresh);
    const bareAnswered: string[] = [];
    while (bare.order.length) {
      bareAnswered.push(bare.order[0].id);
      const rest = (cards: Card[]) => cards.filter((c) => !bareAnswered.includes(c.id));
      bare = queueOf([], rest(reviews), rest(fresh));
    }
    expect(bareAnswered.findIndex((id) => id.startsWith('n'))).toBeGreaterThan(100);
  });

  it("starts from the rebuilt queue when there's no earlier one or nothing in common", () => {
    const next = queueOf([], [card('a'), card('b')], [card('n', 0)]);
    expect(keepSessionOrder(undefined, next)).toBe(next);
    const other = queueOf([], [card('x')], []);
    expect(ids(keepSessionOrder(other, next).main)).toEqual(ids(next.main));
  });

  it('drops what left, keeps the rest where it was, and takes the cards as the rebuild has them', () => {
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((id) => card(id));
    const prev = queueOf([], [a, b, c, d], []);
    const b2 = { ...b, suspended: true };
    // The rebuild puts d first (say a different review order) and has lost a.
    const next = queueOf([], [d, c, b2], []);
    const kept = keepSessionOrder(prev, next);
    expect(ids(kept.main)).toEqual(['b', 'c', 'd']);
    expect(kept.main[0]).toBe(b2);
    expect(kept.order).toEqual(kept.main);
  });

  it('puts a card that was not queued before after the card ahead of it in the rebuilt order, or first', () => {
    const [a, b, c, back, extra] = [card('a'), card('b'), card('c'), card('back'), card('extra', 0)];
    const prev = queueOf([], [a, b, c], []);
    const next: Queue = { due: [], fresh: [extra], order: [back, a, b, extra, c], main: [back, a, b, extra, c] };
    expect(ids(keepSessionOrder(prev, next).main)).toEqual(['back', 'a', 'b', 'extra', 'c']);
  });

  it('takes the learning steps around the mixed stretch from the rebuild, as they are timed', () => {
    const [l1, l2, l3, a, b] = [card('l1'), card('l2'), card('l3'), card('a'), card('b')];
    const prev = queueOf([l1], [a, b], []);
    const next = queueOf([l2], [b, a], [], [l3]);
    expect(ids(keepSessionOrder(prev, next).order)).toEqual(['l2', 'a', 'b', 'l3']);
  });
});
