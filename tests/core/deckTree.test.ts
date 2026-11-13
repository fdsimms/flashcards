import { describe, expect, it } from 'vitest';
import { makeCards } from '../../src/core/cards';
import { deckLimits, deckLineage, deckListTotals, deckRows, deckTree, earlierDeckToStudy, isInDeck, nextDeckToStudy, shownDeckRows, treeQueue, type TreeQueueInput } from '../../src/core/deckTree';
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
  it('puts decks dragged into place first among their siblings, the rest by name after them', () => {
    const position = new Map([['Trivia', 0], ['Languages::Thai', 0], ['Languages', 1]]);
    expect(deckTree(['Languages::Polski', 'Languages::Thai', 'Trivia', 'Art'], (d) => position.get(d)).map((d) => d.deck)).toEqual([
      'Trivia', 'Languages', 'Languages::Thai', 'Languages::Polski', 'Art',
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
  it('lists a deck with no cards when asked to, in its place among the rest', () => {
    const rows = deckRows(input({ 'Languages::Thai': newCards(2) }), ['Languages::Polski', 'Empty']);
    expect(rows.map((r) => [r.deck, r.due, r.fresh, r.total])).toEqual([
      ['Empty', 0, 0, 0],
      ['Languages', 0, 2, 2],
      ['Languages::Polski', 0, 0, 0],
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

  it('shows a previewed card again when its delay is up, ahead of the rest of the preview deck', () => {
    const preview = { weights: [], desiredRetention: 0.9, maxInterval: 36500, filtered: { reschedule: false } };
    const [waiting, other] = reviewCards(2, 20).map((c, i) => ({ ...c, filteredDeck: 'Peek', filteredDue: -100000 + i }));
    const at = (m: number) => new Date(NOW.getTime() + m * 60000).toISOString();
    const q = (c: Card) => treeQueue('Peek', { ...input({ Peek: [c, other] }), paramsFor: () => preview });
    // Every card in a preview deck is a review, due now whatever its own due date.
    expect(q(waiting).order.map((c) => c.id)).toEqual([waiting.id, other.id]);
    expect(q({ ...waiting, previewDue: at(-1) }).order.map((c) => c.id)).toEqual([waiting.id, other.id]);
    expect(q({ ...waiting, previewDue: at(10) }).order.map((c) => c.id)).toEqual([other.id]);
  });

  it("holds back a sibling of a card gathered before it, by the sibling's preset", () => {
    const [front] = newCards(1);
    const back = { ...front, id: `${front.noteId}:reverse`, kind: 'reverse' as const };
    const bury = { weights: [], desiredRetention: 0.9, maxInterval: 36500, bury: { new: true, reviews: true, interdayLearning: true } };
    const q = (params?: typeof bury) => treeQueue('D', { ...input({ D: [front, back] }), paramsFor: () => params });
    expect(q(bury).fresh.map((c) => c.id)).toEqual([front.id]);
    expect(q(undefined).fresh).toHaveLength(2);
  });

  it("doesn't let a sibling the limits leave out bury the other, as Anki checks the limit first", () => {
    const [front] = newCards(1);
    const back = { ...front, id: `${front.noteId}:reverse`, kind: 'reverse' as const };
    const [other] = newCards(1);
    const bury = { weights: [], desiredRetention: 0.9, maxInterval: 36500, bury: { new: true, reviews: true, interdayLearning: true } };
    // P::A has no new cards left today, so its card isn't gathered and buries nothing in P::B.
    const q = treeQueue('P', {
      ...input({ 'P::A': [front], 'P::B': [back, other] }, { 'P::A': { newPerDay: 0, reviewsPerDay: 200 } }),
      paramsFor: () => bury,
    });
    expect(q.fresh.map((c) => c.id).sort()).toEqual([back.id, other.id].sort());
  });
});

describe('collapsed decks on the deck list', () => {
  const rows = ['A', 'A::B', 'A::B::C', 'A::D', 'E'].map((deck) => ({ deck, name: deck.split('::').pop()!, depth: deck.split('::').length - 1 }));
  const shown = (collapsed: string[]) => shownDeckRows(rows, new Set(collapsed)).map((r) => `${r.deck}${r.hasSubdecks ? (r.collapsed ? '+' : '-') : ''}`);

  it('hides every deck under a collapsed one, and marks which decks have subdecks', () => {
    expect(shown([])).toEqual(['A-', 'A::B-', 'A::B::C', 'A::D', 'E']);
    expect(shown(['A::B'])).toEqual(['A-', 'A::B+', 'A::D', 'E']);
    expect(shown(['A'])).toEqual(['A+', 'E']);
    expect(shown(['A', 'A::B'])).toEqual(['A+', 'E']);
  });

  it("ignores a collapsed flag on a deck with no subdecks to hide", () => {
    expect(shown(['E', 'A::D'])).toEqual(['A-', 'A::B-', 'A::B::C', 'A::D', 'E']);
  });
});

describe('deckListTotals', () => {
  it('sums the top-level decks, which already count their subdecks', () => {
    const rows = deckRows(input({
      'Languages::Thai': newCards(2),
      'Languages::Polski': reviewCards(3, 10),
      Trivia: newCards(4),
    }));
    // Languages' row is 3 due and 2 new, and its two subdeck rows repeat those: only top rows count.
    expect(deckListTotals(rows)).toEqual({ due: 3, fresh: 6 });
  });
  it('is zero for no decks', () => {
    expect(deckListTotals([])).toEqual({ due: 0, fresh: 0 });
  });
});

describe('held cards', () => {
  it('leaves held cards out of the deck list and the review queue alike', () => {
    const fresh = newCards(2);
    const due = reviewCards(1, 10);
    const held = { ...input({ 'Languages::Es': [...fresh, ...due] }), held: new Set([fresh[0].id, due[0].id]) };
    const q = treeQueue('Languages', held);
    expect([q.due, q.fresh]).toEqual([[], [fresh[1]]]);
    expect(deckRows(held).map((r) => [r.deck, r.due, r.fresh])).toEqual([
      ['Languages', 0, 1],
      ['Languages::Es', 0, 1],
    ]);
  });
});

describe('inheritedSetting', () => {
  it("takes the deck's own value, else the nearest ancestor's", async () => {
    const { inheritedSetting } = await import('../../src/core/deckTree');
    const all = new Map([['A', { offerSooner: false }], ['A::B', { offerSooner: true }]]);
    expect(inheritedSetting('A::B::C', all, 'offerSooner')).toBe(true);
    expect(inheritedSetting('A::D', all, 'offerSooner')).toBe(false);
    expect(inheritedSetting('E', all, 'offerSooner')).toBeUndefined();
  });
});

describe('the next deck to study', () => {
  const row = (deck: string, due: number, fresh = 0) => ({ deck, name: deck.split('::').pop()!, depth: deck.split('::').length - 1, due, fresh, total: due + fresh });
  const rows = [row('A', 3), row('A::B', 3), row('C', 0), row('D', 0, 2), row('D::E', 0, 2), row('F', 4)];

  it('skips the deck\'s own subdecks and decks with nothing to study', () => {
    expect(nextDeckToStudy(rows, new Set(), 'A')).toBe('D');
    expect(nextDeckToStudy(rows, new Set(), 'A::B')).toBe('D');
  });

  it('steps into a subdeck when the deck above it is done', () => {
    expect(nextDeckToStudy(rows, new Set(), 'D')).toBe('F');
    expect(nextDeckToStudy([row('D', 0), row('D::E', 0, 2)], new Set(), 'D')).toBeUndefined();
  });

  it("doesn't offer a deck hidden under a collapsed one, or anything after the last deck", () => {
    expect(nextDeckToStudy(rows, new Set(['D']), 'A')).toBe('D');
    expect(nextDeckToStudy([row('A', 1), row('B', 0, 1), row('B::C', 0, 1)], new Set(['B']), 'A')).toBe('B');
    expect(nextDeckToStudy(rows, new Set(), 'F')).toBeUndefined();
    expect(nextDeckToStudy(rows, new Set(), 'Missing')).toBeUndefined();
  });
});

describe('the earlier deck to study', () => {
  const row = (deck: string, due: number, fresh = 0) => ({ deck, name: deck.split('::').pop()!, depth: deck.split('::').length - 1, due, fresh, total: due + fresh });
  const rows = [row('A', 0), row('B', 2), row('B::C', 2), row('D', 0, 1), row('E', 0)];

  it('is the first deck from the top with something to study', () => {
    expect(earlierDeckToStudy(rows, new Set(), 'E')).toBe('B');
    expect(earlierDeckToStudy(rows, new Set(), 'D')).toBe('B');
  });

  it("skips the deck's parents and decks hidden under a collapsed one", () => {
    expect(earlierDeckToStudy(rows, new Set(), 'B::C')).toBeUndefined();
    expect(earlierDeckToStudy([row('A', 3), row('A::B', 3), row('C', 0)], new Set(), 'A::B')).toBeUndefined();
    expect(earlierDeckToStudy([row('A', 2), row('A::B', 2), row('C', 0)], new Set(['A']), 'C')).toBe('A');
  });

  it('is undefined when nothing above has cards or the deck is unknown', () => {
    expect(earlierDeckToStudy(rows, new Set(), 'A')).toBeUndefined();
    expect(earlierDeckToStudy(rows, new Set(), 'Missing')).toBeUndefined();
  });
});

describe('treeQueue, tagged cards first', () => {
  // Cards in position order; the last `tagged` of them are the boosted ones.
  const withBoost = (total: number, tagged: number, newPerDay: number, percent: number) => {
    const cards = newCards(total).map((c, i) => ({ ...c, position: i }));
    const boosted = new Set(cards.slice(total - tagged).map((c) => c.noteId));
    const q = treeQueue('Thai', {
      ...input({ Thai: cards }, { Thai: { newPerDay, reviewsPerDay: 200 } }),
      boostFor: () => ({ noteIds: boosted, percent }),
    });
    return { q, cards, boosted };
  };
  it('puts tagged new cards ahead of the rest, within the same daily limit', () => {
    const { q, cards } = withBoost(10, 2, 5, 50);
    expect(q.fresh.map((c) => c.id).slice(0, 2).sort()).toEqual(cards.slice(8).map((c) => c.id).sort());
    expect(q.fresh).toHaveLength(5);
  });
  it("takes no more than the percentage of the day's room, rounded up, and the rest wait in line", () => {
    const { q, cards } = withBoost(10, 6, 5, 50);
    const first = q.fresh.slice(0, 3).map((c) => c.id);
    expect(first.every((id) => cards.slice(4).some((c) => c.id === id))).toBe(true);
    // The other boosted cards come after, in their usual place among the rest, not ahead of position 0.
    expect(q.fresh[3].id).toBe(cards[0].id);
    expect(q.fresh).toHaveLength(5);
  });
  it('leaves the order alone with nothing tagged', () => {
    const { q, cards } = withBoost(4, 0, 20, 50);
    expect(q.fresh.map((c) => c.id)).toEqual(cards.map((c) => c.id));
  });
});
