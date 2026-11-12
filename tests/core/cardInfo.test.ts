import { describe, expect, it } from 'vitest';
import { cardInfo, cardTypeName, historyFromReviews, historyFromRevlog } from '../../src/core/cardInfo';
import { newSchedState } from '../../src/core/scheduler';
import type { Card, Note, NoteType } from '../../src/core/types';
import { NOW } from '../support/fixtures';

const note: Note = { id: '1794408858000', deck: 'Polski', model: 'Basic', fields: {}, tags: [] };
const basic: NoteType = { name: 'Basic', kind: 'normal', fields: ['Front', 'Back'], css: '', templates: [{ ord: 0, name: 'Card 1', front: '', back: '' }, { ord: 1, name: 'Reverse', front: '', back: '' }] } as NoteType;
const added = new Date(2026, 9, 1, 9);
const card: Card = {
  id: '1794408858000:t1', noteId: note.id, kind: 't1', suspended: false, retired: false, ankiId: String(added.getTime()),
  sched: {
    due: new Date(2026, 10, 20, 9).toISOString(), stability: 12, difficulty: 5.5, elapsedDays: 0, scheduledDays: 10,
    learningSteps: 0, reps: 4, lapses: 1, state: 2, lastReview: new Date(2026, 10, 10, 9).toISOString(),
  },
};
const at = (d: number, h = 9) => new Date(2026, 10, d, h).getTime();

describe('historyFromRevlog', () => {
  it('reads each row, newest first, with the interval in days or as a step', () => {
    const h = historyFromRevlog([
      { id: at(1), ease: 3, ivl: -600, time: 4000, type: 0 },
      { id: at(10), ease: 1, ivl: 0, time: 9000, type: 1 },
      { id: at(3), ease: 4, ivl: 5, time: 2000, type: 0 },
      { id: at(11), ease: 0, ivl: 0, time: 0, type: 4 },
    ]);
    expect(h.map((e) => [e.kind, e.rating, e.interval, e.timeMs])).toEqual([
      ['Manual', 0, undefined, undefined],
      ['Review', 1, undefined, 9000],
      ['Learn', 4, '5d', 2000],
      ['Learn', 3, '10m', 4000],
    ]);
  });
});

describe('historyFromReviews', () => {
  it("keeps only this card's answers, newest first, with the interval each set", () => {
    const e = (cardId: string, d: number, due: Date) => ({
      cardId, rating: 3 as const, reviewedAt: new Date(at(d)).toISOString(), state: 2, due: due.toISOString(), stability: 1, difficulty: 5,
    });
    const h = historyFromReviews([e('a', 1, new Date(at(4))), e('b', 2, new Date(at(3))), e('a', 5, new Date(at(15)))], 'a');
    expect(h.map((x) => [x.at.getDate(), x.interval])).toEqual([[5, '10d'], [1, '3d']]);
  });
});

describe('cardInfo', () => {
  const history = historyFromRevlog([
    { id: at(1), ease: 3, ivl: 1, time: 4000, type: 0 },
    { id: at(10), ease: 3, ivl: 10, time: 6000, type: 1 },
    { id: at(11), ease: 0, ivl: 10, time: 0, type: 4 },
  ]);

  it("gives the card's dates, memory and times, leaving changes made by hand out of the answers", () => {
    const info = cardInfo(card, note, basic, history, { now: NOW, weights: [] });
    expect(info).toMatchObject({
      added, firstAnswer: new Date(at(1)), latestAnswer: new Date(at(10)),
      due: { kind: 'review', at: new Date(card.sched.due) }, interval: 10, stability: 12, difficulty: 50,
      reviews: 4, lapses: 1, averageMs: 5000, totalMs: 10000, cardType: 'Reverse', noteType: 'Basic', deck: 'Polski',
    });
    expect(info.retrievability).toBeGreaterThan(80);
    expect(info.retrievability).toBeLessThan(100);
  });

  it("gives a new card its place in the new cards, and no memory", () => {
    const info = cardInfo({ ...card, position: 7, sched: newSchedState(NOW) }, note, basic, [], { now: NOW, weights: [] });
    expect(info).toMatchObject({ due: { kind: 'new', position: 7 }, stability: undefined, difficulty: undefined, retrievability: undefined, firstAnswer: undefined });
  });

  it('names the home deck of a card in a filtered deck', () => {
    expect(cardInfo({ ...card, filteredDeck: 'Cram' }, note, basic, [], { now: NOW, weights: [] })).toMatchObject({ deck: 'Cram', homeDeck: 'Polski' });
  });
});

describe('cardTypeName', () => {
  it("names Omnilanguage's cards, a template by its name, and a cloze by its number", () => {
    expect(cardTypeName({ ...card, kind: 'reverse' }, undefined)).toBe('Reverse');
    expect(cardTypeName({ ...card, kind: 't0' }, basic)).toBe('Card 1');
    expect(cardTypeName({ ...card, kind: 't2' }, { ...basic, kind: 'cloze' })).toBe('Cloze 3');
  });
});
