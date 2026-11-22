import { describe, expect, it } from 'vitest';
import type { Cram } from '../../src/core/cram';
import { addSummary, cramWordsRequest, SUGGEST_EXCLUDE_MAX, suggestedWords, wordsToLeaveOut } from '../../src/core/cramWords';
import type { LessonWordCandidate } from '../../src/core/lessonWords';
import type { Note } from '../../src/core/types';
import { omniNote } from '../support/fixtures';

const thai = (id: string, entry: string, meaning = 'x'): Note => ({ ...omniNote({ Entry: entry, Meaning: meaning }), id });
const polish = (id: string, entry: string): Note => ({ ...omniNote({ Entry: entry, Meaning: 'x', Language: 'Polish' }), id });
const word = (text: string): LessonWordCandidate => ({ text, reading: '', english: 'x' });
const cram = (over: Partial<Cram> = {}): Cram => ({
  id: 'race-2026-11-22', name: 'Talking about the 5k race I ran today', date: '2026-11-22', createdAt: new Date(2026, 10, 20).toISOString(), addNew: true, rounds: [], ...over,
});

describe('cramWordsRequest', () => {
  it('sends the cram name as the topic, what happened and the steer, each tidied', () => {
    const r = cramWordsRequest('th', cram({ facts: ' I ran\n 5 km ' }), '  how it   felt ', ['วิ่ง']);
    expect(r).toEqual({ language: 'th', topic: 'Talking about the 5k race I ran today', facts: 'I ran 5 km', focus: 'how it felt', exclude: ['วิ่ง'] });
  });

  it('sends no topic for an untitled cram, whose stand-in name says nothing', () => {
    expect(cramWordsRequest('th', cram({ untitled: true, name: 'Thai lesson' }), '', []).topic).toBe('');
  });
});

describe('wordsToLeaveOut', () => {
  it('lists the cram words, the ones asked for and the ones shown, once each', () => {
    const out = wordsToLeaveOut(cram({ requested: [{ text: 'ซ้อม', english: 'train' }] }), [thai('1', 'วิ่ง')], [word('ซ้อม'), word('เส้นชัย')]);
    expect(out).toEqual(['วิ่ง', 'ซ้อม', 'เส้นชัย']);
  });

  it('keeps the newest when there are too many', () => {
    const shown = Array.from({ length: SUGGEST_EXCLUDE_MAX + 5 }, (_, i) => word(`w${i}`));
    const out = wordsToLeaveOut(cram(), [], shown);
    expect(out).toHaveLength(SUGGEST_EXCLUDE_MAX);
    expect(out.at(-1)).toBe(`w${SUGGEST_EXCLUDE_MAX + 4}`);
  });
});

describe('suggestedWords', () => {
  const run = thai('1', 'วิ่ง');
  const tired = thai('2', 'เหนื่อย');

  it('finds the deck note for a word and leaves the rest as needing a card', () => {
    const out = suggestedWords([word('เหนื่อย'), word('เส้นชัย')], [run, tired], cram(), [run], 'th');
    expect(out.map((s) => [s.candidate.text, s.note?.id])).toEqual([['เหนื่อย', '2'], ['เส้นชัย', undefined]]);
  });

  it('leaves out a word whose note is already in the cram', () => {
    expect(suggestedWords([word('วิ่ง')], [run], cram(), [run], 'th')).toEqual([]);
  });

  it('leaves out a word already being written for the cram and a word repeated', () => {
    const out = suggestedWords([word('ซ้อม'), word('เส้นชัย'), word('เส้นชัย')], [], cram({ requested: [{ text: 'ซ้อม', english: 'train' }] }), [], 'th');
    expect(out.map((s) => s.candidate.text)).toEqual(['เส้นชัย']);
  });

  it("matches only notes in the cram's language", () => {
    const out = suggestedWords([word('książka')], [polish('9', 'książka')], cram(), [], 'th');
    expect(out[0].note).toBeUndefined();
  });
});

describe('addSummary', () => {
  const note = thai('1', 'วิ่ง');
  it('says how many come from the deck and how many need a card', () => {
    const s = addSummary([{ candidate: word('วิ่ง'), note }, { candidate: word('a') }, { candidate: word('b') }]);
    expect(s).toEqual({ label: 'Add 3 words', detail: '1 from your deck. 2 new cards for Claude to write.' });
  });
  it('is singular for one', () => {
    expect(addSummary([{ candidate: word('a') }])).toEqual({ label: 'Add 1 word', detail: '1 new card for Claude to write.' });
    expect(addSummary([{ candidate: word('วิ่ง'), note }])).toEqual({ label: 'Add 1 word', detail: '1 from your deck.' });
  });
});
