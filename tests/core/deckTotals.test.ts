import { describe, expect, it } from 'vitest';
import { makeCards } from '../../src/core/cards';
import { deckTotals, totalsLine } from '../../src/core/deckTotals';
import { deckRows, type TreeQueueInput } from '../../src/core/deckTree';
import type { Card } from '../../src/core/types';
import { NOW, omniNote } from '../support/fixtures';

const H = 4;
let n = 0;
/** One note's two cards (a forward card and a reverse one of it). */
function note(): Card[] {
  const [a] = makeCards({ ...omniNote(), id: `t${n++}` }, NOW);
  return [a, { ...a, id: `${a.id}-r` }];
}
const review = (c: Card, days: number): Card => ({ ...c, sched: { ...c.sched, state: 2, scheduledDays: days, due: new Date(2026, 10, 12, 12).toISOString() } });

describe('deckTotals', () => {
  it('counts a note once per state and every card', () => {
    const [a, b] = note();
    const t = deckTotals([a, b], new Set(), NOW, H);
    expect(t.new).toEqual({ notes: 1, cards: 2 });
  });

  it('leaves suspended and retired cards out of new, and counts a note under each state its cards are in', () => {
    const [a, b] = note();
    const t = deckTotals([{ ...a, suspended: true }, b, ...note().map((c) => ({ ...c, retired: true }))], new Set(), NOW, H);
    expect(t.new).toEqual({ notes: 1, cards: 1 });
    expect(t.suspended).toEqual({ notes: 1, cards: 1 });
    expect(t.buried.cards + t.learning.cards + t.young.cards + t.mature.cards).toBe(0);
  });

  it('splits studied cards at the mature interval and counts learning and relearning together', () => {
    const [a, b] = note();
    const [c, d] = note();
    const t = deckTotals([review(a, 20), review(b, 21), { ...c, sched: { ...c.sched, state: 1 } }, { ...d, sched: { ...d.sched, state: 3 } }], new Set(), NOW, H);
    expect(t.young.cards).toBe(1);
    expect(t.mature.cards).toBe(1);
    expect(t.learning).toEqual({ notes: 1, cards: 2 });
  });

  it('counts a card buried today as buried, not new, and one buried before today as new', () => {
    const [a] = note();
    const [b] = note();
    const t = deckTotals([{ ...a, buriedAt: new Date(2026, 10, 11, 9).toISOString() }, { ...b, buriedAt: new Date(2026, 10, 9, 9).toISOString() }], new Set(), NOW, H);
    expect(t.buried.cards).toBe(1);
    expect(t.new.cards).toBe(1);
  });

  it('counts skill cards apart, in every state, and leaves them out of the rest', () => {
    const [a, b] = note();
    const [c] = note();
    const t = deckTotals([a, { ...b, suspended: true }, c], new Set([a.id, b.id]), NOW, H);
    expect(t.skills).toEqual({ notes: 1, cards: 2 });
    expect(t.new).toEqual({ notes: 1, cards: 1 });
    expect(t.suspended.cards).toBe(0);
  });

  it('says only what there is to say', () => {
    expect(totalsLine(deckTotals([], new Set(), NOW, H))).toBe('');
    const [a, b] = note();
    expect(totalsLine(deckTotals([a, { ...b, suspended: true }], new Set(), NOW, H))).toBe('1 new note waiting · 1 suspended');
  });
});

describe('deckRows totals', () => {
  it('counts a card in a filtered deck under the deck it came from', () => {
    const [a] = note();
    const input: TreeQueueInput = {
      gateFor: () => undefined, skillCards: new Set(), dayStartsAtHour: H, now: NOW,
      cardsByDeck: new Map([['Filtered', [a]]]), homeDeckOf: () => 'Home',
      limitsFor: () => ({ newPerDay: 20, reviewsPerDay: 200 }), studiedByDeck: new Map(),
    };
    const rows = deckRows(input, ['Home']);
    expect(rows.find((r) => r.deck === 'Home')!.totals!.new.cards).toBe(1);
    expect(rows.find((r) => r.deck === 'Filtered')!.totals!.new.cards).toBe(0);
  });

  it('rolls subdecks up into their parent', () => {
    const input: TreeQueueInput = {
      gateFor: () => undefined, skillCards: new Set(), dayStartsAtHour: H, now: NOW,
      cardsByDeck: new Map([['A', note()], ['A::B', note()]]),
      limitsFor: () => ({ newPerDay: 20, reviewsPerDay: 200 }), studiedByDeck: new Map(),
    };
    const rows = deckRows(input);
    expect(rows.find((r) => r.deck === 'A')!.totals!.new.notes).toBe(2);
    expect(rows.find((r) => r.deck === 'A::B')!.totals!.new.notes).toBe(1);
  });
});
