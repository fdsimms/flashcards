import { describe, expect, it } from 'vitest';
import { makeCards } from '../../src/core/cards';
import { cardOrd, fnvHash, gatherNew, intersperse, mix, sortNew, sortReviews, type SortContext } from '../../src/core/order';
import type { Card } from '../../src/core/types';
import { NOW, omniNote } from '../support/fixtures';

const H = 4;
const [base] = makeCards(omniNote(), NOW);
const card = (id: string, over: Partial<Card> = {}, sched: Partial<Card['sched']> = {}): Card =>
  ({ ...base, id, noteId: id, ...over, sched: { ...base.sched, ...sched } });
const ctx = (decks: Record<string, string> = {}): SortContext => ({
  now: NOW, dayStartsAtHour: H, deckOf: (c) => decks[c.id] ?? 'D', noteOf: (c) => c.noteId, weightsOf: () => [],
});

describe("Anki's study order", () => {
  it("hashes as Anki's SQL fnvhash does", () => {
    // Values from Anki's own `SELECT fnvhash(...)`, which returns the signed 64-bit value.
    expect(BigInt.asIntN(64, fnvHash(1794408858017n, 812n))).toBe(-6872340400651583589n);
    expect(BigInt.asIntN(64, fnvHash(7n))).toBe(5465015992139406178n);
  });

  it("spaces one list through another as Anki's Intersperser does", () => {
    // Anki's own test vectors (rslib intersperser.rs).
    expect(intersperse([1, 2, 3], [11, 22])).toEqual([1, 11, 2, 22, 3]);
    expect(intersperse([1, 2, 3], [11, 22, 33, 44, 55, 66])).toEqual([11, 1, 22, 33, 2, 44, 55, 3, 66]);
    expect(mix([1, 2], [11], 1)).toEqual([1, 2, 11]);
    expect(mix([1, 2], [11], 2)).toEqual([11, 1, 2]);
  });

  it('reads the template ordinal from the kind', () => {
    expect(cardOrd(card('a', { kind: 't2' }))).toBe(2);
    expect(cardOrd(card('a', { kind: 'reverse' }))).toBe(1);
    expect(cardOrd(card('a', { kind: 'forward' }))).toBe(0);
  });

  it('gathers new cards deck by deck in position order, and sorts them by template', () => {
    const cards = [
      card('b1', { kind: 'reverse', position: 1 }), card('b0', { kind: 'forward', position: 1 }),
      card('a5', { kind: 'forward', position: 5 }), card('c2', { kind: 'forward', position: 2 }),
    ];
    const decks = { b1: 'P::Two', b0: 'P::Two', a5: 'P', c2: 'P::One' };
    const gathered = gatherNew(cards, 0, ctx(decks), () => true);
    // The parent's cards first, then each subdeck in name order; within a deck by position, then template.
    expect(gathered.map((c) => c.id)).toEqual(['a5', 'c2', 'b0', 'b1']);
    // The default sort (by template) keeps that order within each template.
    expect(sortNew(gathered, 0, ctx(decks)).map((c) => c.id)).toEqual(['a5', 'c2', 'b0', 'b1']);
    expect(gatherNew(cards, 1, ctx(decks), () => true).map((c) => c.id)).toEqual(['b0', 'b1', 'c2', 'a5']);
    expect(gatherNew(cards, 2, ctx(decks), () => true).map((c) => c.id)).toEqual(['a5', 'c2', 'b0', 'b1']);
    // A deck whose limit is spent is passed over; the next one is still gathered.
    expect(gatherNew(cards, 0, ctx(decks), (c) => c.id !== 'a5').map((c) => c.id)).toEqual(['c2', 'b0', 'b1']);
  });

  it('sorts reviews by due day by default, then by a stable shuffle', () => {
    const day = (d: number) => new Date(2026, 10, d, 9).toISOString();
    const cards = [card('x', {}, { due: day(11), state: 2 }), card('y', {}, { due: day(9), state: 2 }), card('z', {}, { due: day(10), state: 2 })];
    expect(sortReviews(cards, 0, ctx()).map((c) => c.id)).toEqual(['y', 'z', 'x']);
    expect(sortReviews(cards, 3, ctx()).map((c) => c.id)).toHaveLength(3);
    const ivl = [card('s', {}, { state: 2, scheduledDays: 3 }), card('l', {}, { state: 2, scheduledDays: 30 })];
    expect(sortReviews(ivl, 4, ctx()).map((c) => c.id)).toEqual(['l', 's']);
    // The same shuffle all day.
    expect(sortReviews(cards, 8, ctx())).toEqual(sortReviews([...cards].reverse(), 8, ctx()));
  });
});
