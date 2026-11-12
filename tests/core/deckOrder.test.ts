import { describe, expect, it } from 'vitest';
import { deckDropTarget, deckMove, siblingStep, type RowSlot } from '../../src/core/deckOrder';

// The deck list's order: every deck, parents first.
const DECKS = ['Polski', 'Polski::Odmiana', 'Polski::Odmiana::Verbs', 'Polski::Słówka', 'Русский', 'Thai'];

/** Rows 50 high, one after another, as the deck list shows `decks`. */
const slots = (decks: string[]): RowSlot[] => decks.map((deck, i) => ({ deck, depth: deck.split('::').length - 1, top: i * 50, height: 50 }));

describe('where a drop lands', () => {
  const rows = slots(DECKS);

  it('is the gap nearest the card, by the rows around it', () => {
    // Thai (row 5) dragged up over Русский's midpoint (225).
    expect(deckDropTarget(rows, 'Thai', 220, 0)).toEqual({ after: 'Polski::Słówka', depth: 0, lineY: 200 });
    expect(deckDropTarget(rows, 'Thai', 230, 0)).toMatchObject({ after: 'Русский', depth: 0 });
    expect(deckDropTarget(rows, 'Thai', -40, 0)).toEqual({ after: null, depth: 0, lineY: 0 });
  });

  it('holds the depth to what the gap allows', () => {
    // Under Polski::Słówka: a subdeck of it at most, top-level at least.
    expect(deckDropTarget(rows, 'Thai', 220, 5).depth).toBe(2);
    expect(deckDropTarget(rows, 'Thai', 220, -3).depth).toBe(0);
    // Between Polski and its first subdeck, only as that subdeck's sibling.
    expect(deckDropTarget(rows, 'Thai', 40, 0).depth).toBe(1);
    expect(deckDropTarget(rows, 'Thai', 40, 3).depth).toBe(1);
  });

  it('leaves out the dragged deck and the subdecks that move with it', () => {
    // Polski::Odmiana and its Verbs are one block; past Słówka's midpoint is after Słówka.
    const t = deckDropTarget(rows, 'Polski::Odmiana', 180, 1);
    expect(t).toMatchObject({ after: 'Polski::Słówka', depth: 1 });
  });

  it('draws the line midway across a gap between two groups of rows', () => {
    const gapped: RowSlot[] = [{ deck: 'A', depth: 0, top: 0, height: 50 }, { deck: 'B', depth: 0, top: 62, height: 50 }, { deck: 'C', depth: 0, top: 124, height: 50 }];
    expect(deckDropTarget(gapped, 'C', 70, 0).lineY).toBe(56);
  });
});

describe('what a drop does', () => {
  it('reorders among siblings without renaming', () => {
    expect(deckMove(DECKS, 'Thai', null, 0)).toEqual({ from: 'Thai', to: 'Thai', parent: null, order: ['Thai', 'Polski', 'Русский'] });
    // After a row inside Polski: after Polski itself, at the top level.
    expect(deckMove(DECKS, 'Thai', 'Polski::Odmiana::Verbs', 0)?.order).toEqual(['Polski', 'Thai', 'Русский']);
  });

  it('nests into the deck above, first when dropped right under it', () => {
    expect(deckMove(DECKS, 'Thai', 'Polski', 1)).toEqual({
      from: 'Thai', to: 'Polski::Thai', parent: 'Polski', order: ['Polski::Thai', 'Polski::Odmiana', 'Polski::Słówka'],
    });
    expect(deckMove(DECKS, 'Thai', 'Polski::Słówka', 1)?.order).toEqual(['Polski::Odmiana', 'Polski::Słówka', 'Polski::Thai']);
    expect(deckMove(DECKS, 'Thai', 'Polski::Słówka', 2)).toMatchObject({ to: 'Polski::Słówka::Thai', order: ['Polski::Słówka::Thai'] });
  });

  it('unnests to the parent level, keeping the place it was dropped', () => {
    expect(deckMove(DECKS, 'Polski::Odmiana', 'Polski::Słówka', 0)).toEqual({
      from: 'Polski::Odmiana', to: 'Odmiana', parent: null, order: ['Polski', 'Odmiana', 'Русский', 'Thai'],
    });
  });

  it('is nothing when the deck lands where it was', () => {
    expect(deckMove(DECKS, 'Русский', 'Polski::Słówka', 0)).toBeNull();
    expect(deckMove(DECKS, 'Polski::Słówka', 'Polski::Odmiana::Verbs', 1)).toBeNull();
    expect(deckMove(DECKS, 'Polski', null, 0)).toBeNull();
  });

  it("can't go inside itself or deeper than the row above allows", () => {
    expect(deckMove(DECKS, 'Polski', 'Polski::Odmiana', 2)).toBeNull();
    expect(deckMove(DECKS, 'Thai', 'Polski', 2)).toBeNull();
    expect(deckMove(DECKS, 'Thai', null, 1)).toBeNull();
  });
});

describe('a step up or down, for VoiceOver', () => {
  it('swaps with the sibling beside it, and stops at either end', () => {
    expect(siblingStep(DECKS, 'Polski::Słówka', -1)).toEqual({
      from: 'Polski::Słówka', to: 'Polski::Słówka', parent: 'Polski', order: ['Polski::Słówka', 'Polski::Odmiana'],
    });
    expect(siblingStep(DECKS, 'Polski::Słówka', 1)).toBeNull();
    expect(siblingStep(DECKS, 'Polski', -1)).toBeNull();
  });
});
