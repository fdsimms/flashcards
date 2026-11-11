import { describe, expect, it } from 'vitest';
import { makeCards } from '../../src/core/cards';
import { deckLimits, deckLineage, deckRows, deckTree, isInDeck, treeQueue, type TreeQueueInput } from '../../src/core/deckTree';
import type { Card } from '../../src/core/types';
import { NOW, omniNote } from '../support/fixtures';

const H = 4;
let n = 0;
function newCards(count: number): Card[] {
  return Array.from({ length: count }, () => makeCards({ ...omniNote(), id: `n${n++}` }, NOW)[0]);
}
function reviewCards(count: number, day: number): Card[] {
  return newCards(count).map((c) => ({ ...c, sched: { ...c.sched, state: 2, due: new Date(2026, 10, day, 12).toISOString() } }));
}
function input(cardsByDeck: Record<string, Card[]>, limits: Record<string, { newPerDay: number; reviewsPerDay: number }> = {}, studied: TreeQueueInput['studiedByDeck'] = new Map(), gates: Record<string, number> = {}): TreeQueueInput {
  return {
    gateFor: (d) => gates[d],
    cardsByDeck: new Map(Object.entries(cardsByDeck)),
    limitsFor: (d) => limits[d] ?? { newPerDay: 20, reviewsPerDay: 200 },
    studiedByDeck: studied,
    dayStartsAtHour: H,
    now: NOW,
  };
}

describe('deck paths', () => {
  it('splits lineage and tells a subdeck from a deck that shares a prefix', () => {
    expect(deckLineage('A::B::C')).toEqual(['A', 'A::B', 'A::B::C']);
    expect(isInDeck('Polski::Odmiana', 'Polski')).toBe(true);
    expect(isInDeck('Polski Extra', 'Polski')).toBe(false);
  });
  it('lists parents before children, including parents with no cards of their own', () => {
    expect(deckTree(['Languages::Thai', 'Languages::Polski::Odmiana', 'Trivia']).map((d) => [d.deck, d.name, d.depth])).toEqual([
      ['Languages', 'Languages', 0],
      ['Languages::Polski', 'Polski', 1],
      ['Languages::Polski::Odmiana', 'Odmiana', 2],
      ['Languages::Thai', 'Thai', 1],
      ['Trivia', 'Trivia', 0],
    ]);
  });
  it('takes limits from deck settings, else the defaults', () => {
    const defaults = { newPerDay: 20, reviewsPerDay: 200 };
    expect(deckLimits(undefined, defaults)).toEqual(defaults);
    expect(deckLimits({ weights: [], desiredRetention: 0.9, maxInterval: 1, newPerDay: 1 }, defaults)).toEqual({ newPerDay: 1, reviewsPerDay: 200 });
  });
});

describe('treeQueue', () => {
  it('studies a parent with its subdecks, each subdeck within its own new-card limit', () => {
    const q = treeQueue('Polski', input(
      { Polski: newCards(3), 'Polski::Odmiana': newCards(3) },
      { Polski: { newPerDay: 10, reviewsPerDay: 200 }, 'Polski::Odmiana': { newPerDay: 1, reviewsPerDay: 200 } },
    ));
    expect(q.fresh).toHaveLength(4);
  });
  it("applies the parent's limit over everything under it", () => {
    const q = treeQueue('Polski', input(
      { Polski: newCards(3), 'Polski::Odmiana': newCards(3) },
      { Polski: { newPerDay: 2, reviewsPerDay: 200 } },
    ));
    expect(q.fresh).toHaveLength(2);
  });
  it("counts a subdeck's answers today against its parent's limits, new ones against the review limit too", () => {
    const studied = new Map([['Polski::Odmiana', { introduced: 1, reviewed: 2 }]]);
    const build = (newCardsIgnoreReviewLimit: boolean) => treeQueue('Polski', {
      ...input({ Polski: newCards(3), 'Polski::Odmiana': reviewCards(3, 10) }, { Polski: { newPerDay: 2, reviewsPerDay: 3 } }, studied),
      newCardsIgnoreReviewLimit,
    });
    // As in Anki: 3 reviews less 2 reviewed and 1 new card studied leaves no review room, which caps new cards too.
    expect(build(false).due).toHaveLength(0);
    expect(build(false).fresh).toHaveLength(0);
    // With "new cards ignore review limit": 1 review left, and 1 new.
    expect(build(true).due).toHaveLength(1);
    expect(build(true).fresh).toHaveLength(1);
  });
  it('mixes due cards from every subdeck, most overdue first', () => {
    const early = reviewCards(1, 1);
    const late = reviewCards(1, 5);
    const q = treeQueue('A', input({ 'A::x': late, 'A::y': early }));
    expect(q.due.map((c) => c.id)).toEqual([early[0].id, late[0].id]);
  });
});

describe('treeQueue limits and learn-ahead', () => {
  it('stops reviews at the day\'s limit, most overdue first, and never limits learning cards', () => {
    const reviews = [1, 2, 3].flatMap((d) => reviewCards(1, d));
    const [learning] = newCards(1).map((c) => ({ ...c, sched: { ...c.sched, state: 1, due: NOW.toISOString() } }));
    const q = treeQueue('D', input(
      { D: [...reviews, learning] },
      { D: { newPerDay: 0, reviewsPerDay: 3 } },
      new Map([['D', { introduced: 0, reviewed: 1 }]]),
    ));
    // A learning card due now comes first, as in Anki; it uses none of the review limit.
    expect(q.due.map((c) => c.id)).toEqual([learning.id, reviews[0].id, reviews[1].id]);
  });
  it('shows a learning card up to the learn-ahead limit early, once nothing else is left', () => {
    const soon = newCards(1).map((c) => ({ ...c, sched: { ...c.sched, state: 1, due: new Date(2026, 10, 11, 12, 5).toISOString() } }));
    const later = newCards(1).map((c) => ({ ...c, sched: { ...c.sched, state: 3, due: new Date(2026, 10, 11, 12, 30).toISOString() } }));
    expect(treeQueue('D', input({ D: [...soon, ...later] })).due).toHaveLength(0);
    expect(treeQueue('D', { ...input({ 'D::x': [...soon, ...later] }), learnAheadMinutes: 20 }).due.map((c) => c.id)).toEqual([soon[0].id]);
  });
  it("doesn't learn ahead to a card Anki buried today", () => {
    const soon = newCards(1).map((c) => ({
      ...c, buriedAt: new Date(2026, 10, 11, 9, 0).toISOString(), sched: { ...c.sched, state: 1, due: new Date(2026, 10, 11, 12, 5).toISOString() },
    }));
    expect(treeQueue('D', { ...input({ D: soon }), learnAheadMinutes: 20 }).due).toHaveLength(0);
  });
  it('does not learn ahead while new cards are still waiting', () => {
    const soon = newCards(1).map((c) => ({ ...c, sched: { ...c.sched, state: 1, due: new Date(2026, 10, 11, 12, 5).toISOString() } }));
    const fresh = newCards(1);
    const q = treeQueue('D', { ...input({ D: [...soon, ...fresh] }), learnAheadMinutes: 20 });
    // Counted, as Anki counts it, but shown only once the new card is done.
    expect(q.due).toHaveLength(1);
    expect(q.order.map((c) => c.id)).toEqual([fresh[0].id, soon[0].id]);
  });
});

/** Reviews scheduled under a week out: still in progress. */
function inProgress(count: number): Card[] {
  return newCards(count).map((c) => ({ ...c, sched: { ...c.sched, state: 2, scheduledDays: 3, due: new Date(2026, 11, 1).toISOString() } }));
}
/** Reviews scheduled a week or more out: past the gate. */
function guru(count: number): Card[] {
  return inProgress(count).map((c) => ({ ...c, sched: { ...c.sched, scheduledDays: 7 } }));
}

describe('progress gate', () => {
  const daily1 = { newPerDay: 1, reviewsPerDay: 200 };
  it('lets in new cards up to the cap less what is in progress, ignoring the daily new limit', () => {
    const q = treeQueue('Thai', input({ Thai: [...inProgress(7), ...guru(50), ...newCards(10)] }, { Thai: daily1 }, new Map(), { Thai: 10 }));
    expect(q.fresh).toHaveLength(3);
  });
  it('holds every new card back at the cap', () => {
    const q = treeQueue('Thai', input({ Thai: [...inProgress(10), ...newCards(5)] }, {}, new Map(), { Thai: 10 }));
    expect(q.fresh).toHaveLength(0);
  });
  it("counts the whole subtree, and lifts subdecks' daily limits under it", () => {
    const decks = { Polski: inProgress(2), 'Polski::Odmiana': [...inProgress(3), ...newCards(5)], 'Polski::Rekcja': newCards(5) };
    const limits = { 'Polski::Odmiana': daily1, 'Polski::Rekcja': daily1 };
    expect(treeQueue('Polski', input(decks, limits, new Map(), { Polski: 8 })).fresh).toHaveLength(3);
  });
  it("still applies a parent's gate when a subdeck is opened on its own", () => {
    const decks = { 'Polski::Odmiana': [...inProgress(6), ...newCards(5)], 'Polski::Rekcja': inProgress(3) };
    expect(treeQueue('Polski::Odmiana', input(decks, {}, new Map(), { Polski: 10 })).fresh).toHaveLength(1);
  });
  it('shows the count against the cap on a gated deck row', () => {
    const rows = deckRows(input({ Thai: [...inProgress(4), ...newCards(1)] }, {}, new Map(), { Thai: 10 }));
    expect(rows[0].gate).toEqual({ inProgress: 4, cap: 10 });
  });
});

describe('deckRows', () => {
  it('gives every deck, nested, with what studying it would show', () => {
    const rows = deckRows(input({ 'Languages::Thai': newCards(2), 'Languages::Polski': reviewCards(1, 10) }));
    expect(rows.map((r) => [r.deck, r.due, r.fresh, r.total])).toEqual([
      ['Languages', 1, 2, 3],
      ['Languages::Polski', 1, 0, 1],
      ['Languages::Thai', 0, 2, 2],
    ]);
  });
});

describe("Anki's v3 limits and gathering", () => {
  const day = (d: number, h = 9) => new Date(2026, 10, d, h).toISOString();
  /** A learning card on a day-long step: answered on the 10th, due on the 11th (NOW's day). */
  const interday = (count: number) => newCards(count).map((c) => ({ ...c, sched: { ...c.sched, state: 1, due: day(11), lastReview: day(10) } }));

  it('lets day-long learning cards use up the review limit, before reviews', () => {
    const learning = interday(3);
    const q = treeQueue('D', input({ D: [...learning, ...reviewCards(3, 10)] }, { D: { newPerDay: 0, reviewsPerDay: 2 } }));
    // Two of the three (the same day, so Anki's shuffle picks which), and no reviews.
    expect(q.due).toHaveLength(2);
    expect(q.due.every((c) => learning.some((l) => l.id === c.id))).toBe(true);
  });

  it("applies the parents' limits to a subdeck only with 'apply all parent limits' on", () => {
    const limits = { Polski: { newPerDay: 0, reviewsPerDay: 100 }, 'Polski::Odmiana': { newPerDay: 5, reviewsPerDay: 100 } };
    const cards = { 'Polski::Odmiana': newCards(3) };
    expect(treeQueue('Polski::Odmiana', input(cards, limits)).fresh).toHaveLength(3);
    expect(treeQueue('Polski::Odmiana', { ...input(cards, limits), applyAllParentLimits: true }).fresh).toHaveLength(0);
    expect(treeQueue('Polski', input(cards, limits)).fresh).toHaveLength(0);
  });

  it("uses a today-only limit on its own day, and the deck's usual limit on any other", () => {
    const params = { weights: [], desiredRetention: 0.9, maxInterval: 36500, newPerDay: 1, newLimitToday: { limit: 4, day: '2026-11-11' } };
    expect(deckLimits(params, { newPerDay: 20, reviewsPerDay: 200 }, '2026-11-11').newPerDay).toBe(4);
    expect(deckLimits(params, { newPerDay: 20, reviewsPerDay: 200 }, '2026-11-12').newPerDay).toBe(1);
  });

  it('studies a filtered deck without limits, and leaves its cards out of their home deck', () => {
    const borrowed = reviewCards(4, 10);
    const cards = { Cram: borrowed, Thai: reviewCards(1, 10) };
    const filtered = { weights: [], desiredRetention: 0.9, maxInterval: 36500, filtered: { reschedule: true } };
    const base = { ...input(cards, { Cram: { newPerDay: 0, reviewsPerDay: 0 } }), paramsFor: (d: string) => (d === 'Cram' ? filtered : undefined) };
    expect(treeQueue('Cram', base).due).toHaveLength(4);
    expect(treeQueue('Thai', base).due).toHaveLength(1);
  });

  it("holds back a sibling of a card gathered before it, by the sibling's preset", () => {
    const [front] = newCards(1);
    const back = { ...front, id: `${front.noteId}:reverse`, kind: 'reverse' as const };
    const bury = { weights: [], desiredRetention: 0.9, maxInterval: 36500, bury: { new: true, reviews: true, interdayLearning: true } };
    const q = (params?: typeof bury) => treeQueue('D', { ...input({ D: [front, back] }), paramsFor: () => params });
    expect(q(bury).fresh.map((c) => c.id)).toEqual([front.id]);
    expect(q(undefined).fresh).toHaveLength(2);
  });
});
