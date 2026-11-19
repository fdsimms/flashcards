import { describe, expect, it } from 'vitest';
import { deckSuspension, deckSuspensionWarning } from '../../src/core/deckSuspension';
import { newSchedState } from '../../src/core/scheduler';
import type { Card, Note } from '../../src/core/types';

const NOW = new Date(2026, 10, 12, 9);
const note = (id: string, deck: string): Note => ({ id, deck, model: 'Basic', fields: { Front: id, Back: '' }, tags: [] });
const card = (id: string, noteId: string, over: Partial<Card> = {}): Card => ({ id, noteId, kind: 'forward', suspended: false, retired: false, sched: newSchedState(NOW), ...over });

describe('suspending a deck', () => {
  const notes = [note('a', 'A'), note('b', 'A::B'), note('c', 'A::B::C'), note('x', 'AB'), note('y', 'Other')];
  const cards = [card('a1', 'a'), card('b1', 'b'), card('b2', 'b'), card('c1', 'c'), card('x1', 'x'), card('y1', 'y')];

  it('takes the deck and its subdecks, not a deck that merely shares a prefix', () => {
    const p = deckSuspension(notes, cards, 'A', true);
    expect(p.cards.map((c) => c.id)).toEqual(['a1', 'b1', 'b2', 'c1']);
    expect(p.subdecks).toEqual([{ deck: 'A::B', count: 2 }, { deck: 'A::B::C', count: 1 }]);
  });

  it('leaves out cards already in the wanted state and retired ones', () => {
    const some = [card('a1', 'a', { suspended: true }), card('b1', 'b', { retired: true }), card('c1', 'c')];
    expect(deckSuspension(notes, some, 'A', true).cards.map((c) => c.id)).toEqual(['c1']);
    expect(deckSuspension(notes, some, 'A', false).cards.map((c) => c.id)).toEqual(['a1']);
  });

  it("goes by a card's own deck, even in a filtered deck", () => {
    const held = [card('b1', 'b', { filteredDeck: 'Cram' }), card('o1', 'y', { filteredDeck: 'A' })];
    expect(deckSuspension(notes, held, 'A', true).cards.map((c) => c.id)).toEqual(['b1']);
  });
});

describe('the suspension warning', () => {
  it('names the subdecks with their counts', () => {
    const w = deckSuspensionWarning({ cards: Array(1240).fill(card('c', 'n')), subdecks: [{ deck: 'A::B', count: 1 }, { deck: 'A::C', count: 2 }] }, true);
    expect(w).toBe('1,240 cards will stop showing up in reviews until you unsuspend them.\n\nIn 2 subdecks:\nA::B (1)\nA::C (2)');
  });

  it('counts the names past the display limit and says so for unsuspending', () => {
    const subdecks = Array.from({ length: 11 }, (_, i) => ({ deck: `A::D${i}`, count: 1 }));
    const w = deckSuspensionWarning({ cards: [card('c', 'n')], subdecks }, false);
    expect(w).toMatch(/^1 card will show up in reviews again\./);
    expect(w).toMatch(/and 3 more subdecks$/);
    expect(deckSuspensionWarning({ cards: [card('c', 'n')], subdecks: [] }, true)).toBe('1 card will stop showing up in reviews until you unsuspend them.');
  });
});
