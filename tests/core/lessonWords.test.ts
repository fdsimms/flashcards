import { describe, expect, it } from 'vitest';
import { makeCards } from '../../src/core/cards';
import { LESSON_MAX_WORDS } from '../../src/core/cram';
import { Refusal } from '../../src/core/failure';
import { addLessonWord, candidateChips, candidateWord, hasLessonWord, lessonWordHint, noCandidatesText, lessonRequestWords, pickerWords, removeLessonWord, wordKey, type LessonWord } from '../../src/core/lessonWords';
import type { Card, Note } from '../../src/core/types';
import { omniNote } from '../support/fixtures';

const H = 4;
const NOW = new Date(2026, 10, 18, 9);
const thai = (id: string, Entry: string, Meaning: string, over: Record<string, string> = {}): Note => ({ ...omniNote({ Entry, Meaning, ...over }), id });
const cardOf = (note: Note, sched: Partial<Card['sched']>): Card => {
  const [card] = makeCards(note, NOW);
  return { ...card, sched: { ...card.sched, ...sched } };
};
const word = (text: string, english = 'x'): LessonWord => ({ text, english });

describe('pickerWords', () => {
  const a = thai('1000', 'กาแฟ', 'coffee');
  const b = thai('3000', 'น้ำ', 'water');
  const c = thai('2000', 'ร้อน', 'hot');
  const pl = { ...omniNote({ Entry: 'kot', Meaning: 'cat', Language: 'Polish' }), id: '4000' };
  const notes = [a, b, c, pl];
  const cards = [
    cardOf(a, { state: 2, due: new Date(2026, 10, 18, 3).toISOString(), lapses: 0 }),
    cardOf(b, { state: 2, due: new Date(2026, 10, 25, 3).toISOString(), lapses: 3 }),
    cardOf(c, { state: 2, due: new Date(2026, 10, 18, 1).toISOString(), lapses: 1 }),
  ];
  const list = (filter: 'recent' | 'due' | 'lapsed', query = '') => pickerWords(notes, cards, 'th', filter, query, NOW, H).map((w) => w.text);

  it('lists the newest notes first and leaves out other languages', () => {
    expect(list('recent')).toEqual(['น้ำ', 'ร้อน', 'กาแฟ']);
  });
  it('lists only what is due today, the one due longest ago first', () => {
    expect(list('due')).toEqual(['ร้อน', 'กาแฟ']);
  });
  it('lists only notes that have lapsed, the most lapses first', () => {
    expect(list('lapsed')).toEqual(['น้ำ', 'ร้อน']);
  });
  it('searches the word and the meaning', () => {
    expect(list('recent', 'WAT')).toEqual(['น้ำ']);
    expect(list('recent', 'กา')).toEqual(['กาแฟ']);
  });
  it('skips a suspended card and a note too long to send', () => {
    const suspended = [{ ...cards[0], suspended: true }, cards[1], cards[2]];
    expect(pickerWords(notes, suspended, 'th', 'due', '', NOW, H).map((w) => w.text)).toEqual(['ร้อน']);
    expect(pickerWords([thai('5', 'กาแฟ', 'x'.repeat(201))], [], 'th', 'recent', '', NOW, H)).toEqual([]);
  });
  it("gives each word with its meaning and its note", () => {
    expect(pickerWords([a], cards, 'th', 'recent', '', NOW, H)).toEqual([{ noteId: '1000', text: 'กาแฟ', english: 'coffee' }]);
  });
});

describe('addLessonWord', () => {
  it('adds a word with the spacing tidied, keeping its note', () => {
    const words = addLessonWord([], { text: '  กาแฟ  เย็น ', english: ' iced   coffee ', noteId: '1' });
    expect(words).toEqual([{ text: 'กาแฟ เย็น', english: 'iced coffee', noteId: '1' }]);
    expect(addLessonWord([], word('a', 'b'))[0]).not.toHaveProperty('noteId');
  });
  it('refuses a blank phrase or meaning, with the reason', () => {
    expect(() => addLessonWord([], word('กาแฟ', ' '))).toThrow(Refusal);
    expect(() => addLessonWord([], word('', 'coffee'))).toThrow('Enter the word and its meaning.');
  });
  it('refuses one that is too long to send', () => {
    expect(() => addLessonWord([], word('x'.repeat(201), 'long'))).toThrow('up to 200 characters');
  });
  it('refuses a duplicate however it is spaced or cased, chosen or typed', () => {
    const words = [{ text: 'Hello there', english: 'x', noteId: '1' }];
    expect(() => addLessonWord(words, word('hello   THERE', 'y'))).toThrow('already in this lesson');
  });
  it('refuses a word past what a lesson teaches', () => {
    const full = Array.from({ length: LESSON_MAX_WORDS }, (_, i) => word(`w${i}`));
    expect(() => addLessonWord(full, word('extra'))).toThrow(`at most ${LESSON_MAX_WORDS} words`);
  });
});

describe('the words in a draft', () => {
  it('removes and finds a word by how it reads', () => {
    const words = [word('A b'), word('c')];
    expect(hasLessonWord(words, 'a  B')).toBe(true);
    expect(removeLessonWord(words, 'a  B').map((w) => w.text)).toEqual(['c']);
    expect(wordKey(' Ab́ ')).toBe(wordKey('Ab́'));
  });
  it('sends only the word and its meaning, in the order chosen', () => {
    expect(lessonRequestWords([{ text: 'a', english: 'b', noteId: '1' }, word('c', 'd')])).toEqual([{ text: 'a', english: 'b' }, { text: 'c', english: 'd' }]);
  });
});

describe('looking up a typed word', () => {
  it('names romanization where the language is not written in Latin letters', () => {
    for (const language of ['th', 'ru', 'el', 'ja'] as const) expect(lessonWordHint(language, 'X')).toBe('Romanization, X or English all work.');
    for (const language of ['fr', 'es', 'de', 'pl', 'nb'] as const) expect(lessonWordHint(language, 'X')).toBe('X or English both work.');
  });

  it('adds the picked candidate as the word and its meaning, without the reading', () => {
    const picked = candidateWord({ text: 'ใหม่', reading: 'mài', english: 'new' });
    expect(picked).toEqual({ text: 'ใหม่', english: 'new' });
    expect(lessonRequestWords(addLessonWord([], picked))).toEqual([{ text: 'ใหม่', english: 'new' }]);
  });

  it('says what was typed and in which language when nothing fits', () => {
    expect(noCandidatesText('  mai   mai ', 'Thai')).toBe('Couldn\'t find a Thai word for "mai mai". Try another spelling.');
  });
});

describe('candidateChips', () => {
  const word = { text: 'แข่ง', reading: 'kêng', english: 'to race' };
  it('says how common a word is and how it is said when that is worth knowing', () => {
    expect(candidateChips({ ...word, commonness: 'common', register: 'formal' }).map((c) => c.label)).toEqual(['Common', 'Formal']);
  });
  it('shows nothing for neutral speech, a blank or a value it does not know', () => {
    expect(candidateChips({ ...word, register: 'neutral' })).toEqual([]);
    expect(candidateChips({ ...word, commonness: '', register: '' })).toEqual([]);
    expect(candidateChips({ ...word, commonness: 'popular' })).toEqual([]);
    expect(candidateChips(word)).toEqual([]);
  });
});
