import { describe, expect, it } from 'vitest';
import { makeCards } from '../../src/core/cards';
import { GURU_INTERVAL_DAYS } from '../../src/core/progress';
import { heldReverseCards } from '../../src/core/reverseHold';
import type { Card, Note, SchedState } from '../../src/core/types';
import { NOW, omniNote } from '../support/fixtures';

const note: Note = { ...omniNote({ GenerateReverse: 'y' }), id: 'w' };
const cardsOf = (n: Note, over: Partial<Record<Card['kind'], Partial<SchedState> & { suspended?: boolean }>> = {}): Card[] =>
  makeCards(n, NOW).map((c) => {
    const { suspended = false, ...sched } = over[c.kind] ?? {};
    return { ...c, suspended, sched: { ...c.sched, ...sched } };
  });
const held = (cards: Card[], notes: Note[] = [note]) => [...heldReverseCards(cards, notes)];

describe('heldReverseCards', () => {
  it('holds a new reverse card while the forward card is new or in progress', () => {
    expect(held(cardsOf(note))).toEqual(['w:reverse']);
    expect(held(cardsOf(note, { forward: { state: 1 } }))).toEqual(['w:reverse']);
    expect(held(cardsOf(note, { forward: { state: 2, scheduledDays: GURU_INTERVAL_DAYS - 1 } }))).toEqual(['w:reverse']);
    expect(held(cardsOf(note, { forward: { state: 3, scheduledDays: 30 } }))).toEqual(['w:reverse']);
  });
  it('lets it in once the forward card is a review scheduled a week or more out', () => {
    expect(held(cardsOf(note, { forward: { state: 2, scheduledDays: GURU_INTERVAL_DAYS } }))).toEqual([]);
  });
  it('never holds a reverse card already started', () => {
    expect(held(cardsOf(note, { reverse: { state: 1 } }))).toEqual([]);
    expect(held(cardsOf(note, { reverse: { state: 2, scheduledDays: 3 } }))).toEqual([]);
  });
  it("doesn't wait for a forward card that isn't studied: none made, or suspended", () => {
    const reverseOnly: Note = { ...omniNote({ GenerateReverse: 'y', SuppressFrontCard: 'y' }), id: 'r' };
    expect(held(cardsOf(reverseOnly), [reverseOnly])).toEqual([]);
    expect(held(cardsOf(note, { forward: { suspended: true } }))).toEqual([]);
  });
  it('leaves other note types alone', () => {
    const basic: Note = { id: 'b', deck: 'Trivia', model: 'Basic', fields: { Front: 'a', Back: 'b' }, tags: [] };
    const cards: Card[] = cardsOf(note).map((c) => ({ ...c, id: `b:${c.kind}`, noteId: 'b' }));
    expect(held(cards, [basic])).toEqual([]);
  });
});
