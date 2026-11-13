import { describe, expect, it } from 'vitest';
import type { Answer } from '../../src/core/stats';
import { isLeechNote, RECENT_DAYS, troubleCards } from '../../src/core/trouble';
import type { Card, Note } from '../../src/core/types';
import { NOW } from '../support/fixtures';

const H = 4;
const THAI = '👅 Languages::🐘 ภาษาไทย';

function note(id: string, deck = THAI, tags: string[] = []): Note {
  return { id, deck, model: 'Omnilanguage', fields: { Entry: id, Meaning: '' }, tags };
}

function card(id: string, noteId: string, over: Partial<Card['sched']> & { suspended?: boolean; retired?: boolean; deck?: string } = {}): Card {
  const { suspended = false, retired = false, deck, ...sched } = over;
  return {
    id, noteId, kind: 'forward', suspended, retired, deck,
    sched: { due: NOW.toISOString(), stability: 5, difficulty: 5, elapsedDays: 0, scheduledDays: 5, learningSteps: 0, reps: 10, lapses: 0, state: 2, lastReview: null, ...sched },
  };
}

const answer = (cardId: string, at: Date, over: Partial<Answer> = {}): Answer => ({ cardId, at, rating: 3, kind: 'review', wasNew: false, takenMs: 5000, ...over });

const run = (input: { cards: Card[]; notes: Note[]; answers?: Answer[]; deck?: string | null; mode?: 'most' | 'lately' }) =>
  troubleCards({ answers: [], deck: null, mode: 'most', now: NOW, dayStartsAtHour: H, ...input });

describe('trouble cards, most missed', () => {
  it('lists cards by lapses, most first, with the reviews they are out of', () => {
    const notes = [note('a'), note('b'), note('c')];
    const cards = [card('a1', 'a', { lapses: 4, reps: 40 }), card('b1', 'b', { lapses: 17, reps: 71 }), card('c1', 'c', { lapses: 0 })];
    expect(run({ cards, notes }).map((r) => [r.card.id, r.misses, r.answers])).toEqual([['b1', 17, 71], ['a1', 4, 40]]);
  });

  it('puts the card missed more often for its reviews first when two have as many lapses', () => {
    const notes = [note('a'), note('b')];
    const cards = [card('a1', 'a', { lapses: 6, reps: 60 }), card('b1', 'b', { lapses: 6, reps: 20 })];
    expect(run({ cards, notes }).map((r) => r.card.id)).toEqual(['b1', 'a1']);
  });

  it('leaves out cards that are suspended, retired or new', () => {
    const notes = [note('a')];
    const cards = [
      card('s', 'a', { lapses: 9, suspended: true }),
      card('r', 'a', { lapses: 9, retired: true }),
      card('n', 'a', { lapses: 9, state: 0 }),
      card('ok', 'a', { lapses: 2 }),
    ];
    expect(run({ cards, notes }).map((r) => r.card.id)).toEqual(['ok']);
  });

  it('narrows to a deck and its subdecks, by the card\'s own home deck', () => {
    const notes = [note('a', THAI), note('b', '🥨 Deutsch'), note('c', `${THAI}::🏛 Consonant Classes`), note('d', '🥨 Deutsch')];
    const cards = [
      card('a1', 'a', { lapses: 1 }), card('b1', 'b', { lapses: 1 }), card('c1', 'c', { lapses: 1 }),
      // A card can sit in another deck than its note.
      card('d1', 'd', { lapses: 1, deck: THAI }),
    ];
    expect(run({ cards, notes, deck: THAI }).map((r) => r.card.id).sort()).toEqual(['a1', 'c1', 'd1']);
  });

  it('marks a note tagged leech, whatever the case of the tag', () => {
    expect(isLeechNote(note('a', THAI, ['verb', 'Leech']))).toBe(true);
    expect(isLeechNote(note('a', THAI, ['leeches']))).toBe(false);
    const rows = run({ cards: [card('a1', 'a', { lapses: 8 })], notes: [note('a', THAI, ['leech'])] });
    expect(rows[0].leech).toBe(true);
  });
});

describe('trouble cards, missed lately', () => {
  it(`counts Again on a review over the last ${RECENT_DAYS} study days, out of the reviews then`, () => {
    const notes = [note('a'), note('b')];
    const cards = [card('a1', 'a', { lapses: 20 }), card('b1', 'b', { lapses: 1 })];
    const answers = [
      answer('b1', new Date(2026, 10, 10, 9), { rating: 1 }),
      answer('b1', new Date(2026, 10, 11, 9), { rating: 1 }),
      answer('b1', new Date(2026, 10, 11, 9, 10), { rating: 3 }),
      // a1 has more lapses in all, but none lately.
      answer('a1', new Date(2026, 10, 11, 9), { rating: 3 }),
    ];
    expect(run({ cards, notes, answers, mode: 'lately' }).map((r) => [r.card.id, r.misses, r.answers])).toEqual([['b1', 2, 3]]);
  });

  it('leaves out answers before the window, by study day', () => {
    const notes = [note('a')];
    const cards = [card('a1', 'a')];
    // The window's first study day starts at 4 AM 29 days before today's.
    const first = new Date(2026, 9, 13, 4);
    const answers = [
      answer('a1', new Date(first.getTime() - 60_000), { rating: 1 }),
      answer('a1', first, { rating: 1 }),
    ];
    expect(run({ cards, notes, answers, mode: 'lately' })[0].misses).toBe(1);
  });

  it('doesn\'t count Again on a relearning or learning step, or in a preview deck, as another miss', () => {
    const notes = [note('a')];
    const cards = [card('a1', 'a')];
    const at = new Date(2026, 10, 11, 9);
    const answers = [
      answer('a1', at, { rating: 1 }),
      answer('a1', at, { rating: 1, kind: 'relearn' }),
      answer('a1', at, { rating: 1, kind: 'learn' }),
      answer('a1', at, { rating: 1, preview: true }),
    ];
    expect(run({ cards, notes, answers, mode: 'lately' }).map((r) => [r.misses, r.answers])).toEqual([[1, 1]]);
  });

  it('leaves out a suspended card even when it was missed lately', () => {
    const answers = [answer('a1', new Date(2026, 10, 11, 9), { rating: 1 })];
    expect(run({ cards: [card('a1', 'a', { suspended: true })], notes: [note('a')], answers, mode: 'lately' })).toEqual([]);
  });
});
