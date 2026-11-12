import { describe, expect, it } from 'vitest';
import { practiceStats } from '../../src/core/formsStats';
import type { PracticeRecord } from '../../src/core/forms';
import type { Note } from '../../src/core/types';
import { omniNote } from '../support/fixtures';

const DECK = '👅 Languages::🇵🇱 Polski';
const noun = (id: string, entry: string, gender: string, plural?: string): Note => ({
  ...omniNote({ Entry: entry, Language: 'polish', Gender: gender, ...(plural ? { Plural: plural } : {}) }),
  id,
  deck: DECK,
});
const at = (d: number, h = 12) => new Date(2026, 10, d, h).toISOString();
const NOW = new Date(2026, 10, 12, 12);
const rec = (noteId: string, key: string, correct: boolean, day: number, given?: string): PracticeRecord => ({
  noteId, key, correct, practicedAt: at(day), ...(given ? { given } : {}),
});

const notes = [noun('a', 'ta córka', 'f', 'córki'), noun('b', 'ta kuzynka', 'f'), noun('c', 'ten ptak', 'm'), noun('d', 'ta rzecz', 'f')];

describe('practiceStats', () => {
  it('is empty before any practice', () => {
    expect(practiceStats(DECK, notes, [], NOW)).toEqual({ answers: 0, right: 0, days: 1, weak: [], mixedUp: [], byGroup: [] });
  });

  it('counts answers, right answers and the days since the first', () => {
    const s = practiceStats(DECK, notes, [rec('a', 'field:Gender', true, 2), rec('a', 'field:Gender', false, 5, 'ten'), rec('c', 'field:Gender', true, 8)], NOW);
    expect([s.answers, s.right, s.days]).toEqual([3, 2, 10]);
  });

  it('lists forms still owed right answers, most owed first, with what the history says', () => {
    const history = [
      rec('a', 'field:Gender', false, 1, 'ten'), rec('a', 'field:Gender', false, 2, 'ten'), rec('a', 'field:Gender', true, 3),
      rec('b', 'field:Gender', false, 4, 'ten'),
      rec('c', 'field:Gender', false, 1, 'to'), rec('c', 'field:Gender', true, 2), rec('c', 'field:Gender', true, 3),
    ];
    const { weak } = practiceStats(DECK, notes, history, NOW);
    expect(weak.map((w) => w.name)).toEqual(['córka · gender', 'kuzynka · gender']);
    expect(weak[0]).toMatchObject({ answer: 'ta', attempts: 3, misses: 2, rightSince: 1, owed: 3 });
    expect(weak[1]).toMatchObject({ attempts: 1, misses: 1, rightSince: 0, owed: 2 });
  });

  it('keeps a word that has a form in a group on its own and names the group when it differs from the label', () => {
    const verb: Note = { ...omniNote({ Entry: 'esperar', Language: 'spanish', Forms: 'present · yo: espero' }), id: 'v', deck: DECK };
    const { weak } = practiceStats(DECK, [verb], [rec('v', 'present · yo', false, 1, 'esperas')], NOW);
    expect(weak[0].name).toBe('esperar · yo · present');
  });

  it('finds mix-ups across the deck, and groups the right rate by kind of form, weakest first', () => {
    const history = [
      rec('a', 'field:Gender', false, 1, 'ten'), rec('b', 'field:Gender', false, 2, 'ten'), rec('d', 'field:Gender', false, 3, 'ten'),
      rec('c', 'field:Gender', true, 3), rec('a', 'field:Plural', true, 4),
    ];
    const s = practiceStats(DECK, notes, history, NOW);
    expect(s.mixedUp).toMatchObject([{ expected: 'ta', given: 'ten', misses: 3, words: 3 }]);
    expect(s.byGroup).toEqual([{ group: 'gender', answers: 4, right: 1 }, { group: 'plural', answers: 1, right: 1 }]);
  });

  it('leaves out words in other decks and answers for notes that are gone', () => {
    const other: Note = { ...noun('z', 'ten kot', 'm'), deck: 'Other' };
    const history = [rec('z', 'field:Gender', false, 1, 'ta'), rec('gone', 'field:Gender', false, 1), rec('c', 'field:Gender', true, 1)];
    const s = practiceStats(DECK, [...notes, other], history, NOW);
    expect([s.answers, s.right]).toEqual([1, 1]);
  });
});
