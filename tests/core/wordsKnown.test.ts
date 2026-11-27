import { describe, expect, it } from 'vitest';
import { makeCards } from '../../src/core/cards';
import { SKILL_TAG } from '../../src/core/skillTag';
import type { Card, Note } from '../../src/core/types';
import { wordsKnown, wordsLine } from '../../src/core/wordsKnown';
import { NOW, omniNote } from '../support/fixtures';

const DAY = 86_400_000;
const thai = (id: string): Note => ({ ...omniNote(), id });
const polish = (id: string): Note => ({ ...omniNote({ Language: 'Polish', Entry: 'kot', Meaning: 'cat' }), id, deck: 'Polski' });
const card = (note: Note, over: Partial<Card> = {}, sched: Partial<Card['sched']> = {}): Card => {
  const base = makeCards(note, NOW)[0];
  return { ...base, ...over, sched: { ...base.sched, ...sched } };
};
/** A card reviewed `ago` days back with memory lasting `stability` days, `interval` days between reviews. */
const reviewed = (note: Note, ago: number, stability: number, interval: number, over: Partial<Card> = {}): Card =>
  card(note, over, { state: 2, stability, scheduledDays: interval, lastReview: new Date(NOW.getTime() - ago * DAY).toISOString() });
const run = (notes: Note[], cards: Card[]) => wordsKnown({ notes, cards, now: NOW, weightsOf: () => [] });

describe('words you know', () => {
  it('counts a word once however many cards it has, by its best-known card', () => {
    const n = thai('a');
    // One card just reviewed, the other long overdue: the word is known by the first.
    const fresh = reviewed(n, 0, 100, 30);
    const stale = reviewed(n, 400, 5, 30, { id: 'a:reverse', kind: 'reverse' });
    const [th] = run([n], [fresh, stale]);
    expect(th).toMatchObject({ name: 'Thai', words: 1, studied: 1, mature: 1, estimate: 1 });
  });

  it('adds up how likely each studied word is to be remembered', () => {
    const notes = ['a', 'b', 'c', 'd'].map(thai);
    // Reviewed as long ago as the memory lasts: FSRS puts recall at 90%, so four such words are about 3.6.
    const cards = notes.map((n) => reviewed(n, 10, 10, 10));
    const [th] = run(notes, cards);
    expect(th.studied).toBe(4);
    expect(th.estimate).toBe(4);
    const long = run(notes, notes.map((n) => reviewed(n, 2000, 10, 10)));
    expect(long[0].estimate).toBeLessThan(3);
    expect(long[0].studied).toBe(4);
  });

  it('tells studied from mature from not started', () => {
    const [a, b, c] = ['a', 'b', 'c'].map(thai);
    const [th] = run([a, b, c], [reviewed(a, 1, 50, 21), reviewed(b, 1, 50, 20), card(c)]);
    expect(th).toMatchObject({ words: 3, studied: 2, mature: 1 });
    expect(wordsLine(th)).toBe('2 studied · 1 mature · 1 not started');
    // A card being learned is studied, never mature.
    expect(run([a], [card(a, {}, { state: 1, scheduledDays: 0 })])[0]).toMatchObject({ studied: 1, mature: 0 });
  });

  it('keeps each language apart, the best known first', () => {
    const t = thai('t');
    const [p1, p2] = [polish('p1'), polish('p2')];
    const out = run([t, p1, p2], [reviewed(t, 0, 50, 30), reviewed(p1, 0, 50, 30), reviewed(p2, 0, 50, 30)]);
    expect(out.map((l) => [l.name, l.tag, l.estimate])).toEqual([['Polish', 'pl-PL', 2], ['Thai', 'th-TH', 1]]);
  });

  it('leaves out what is not a word being studied', () => {
    const word = thai('w');
    const skill: Note = { ...thai('s'), tags: [SKILL_TAG] };
    const trivia: Note = { id: 'q', deck: 'Trivia', model: 'Basic', fields: { Front: 'Capital of Peru', Back: 'Lima' }, tags: [] };
    const off = thai('off');
    const gone = thai('gone');
    const out = run([word, skill, trivia, off, gone], [
      reviewed(word, 0, 50, 30), reviewed(skill, 0, 50, 30), reviewed(trivia, 0, 50, 30),
      reviewed(off, 0, 50, 30, { suspended: true }), reviewed(gone, 0, 50, 30, { retired: true }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: 'Thai', words: 1, studied: 1 });
    // A card whose note isn't among those given (another deck's, in a narrowed view) is skipped.
    expect(run([], [reviewed(word, 0, 50, 30)])).toEqual([]);
  });
});
