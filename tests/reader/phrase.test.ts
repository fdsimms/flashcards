import { describe, expect, it } from 'vitest';
import type { Word } from '../../src/reader/api';
import { locate, phrasePart, phraseRange, phraseText, pickEnd, type PhrasePick } from '../../src/reader/phrase';

const w = (text: string): Word => ({
  text,
  status: /[\p{L}\p{N}]/u.test(text) ? 'known' : null,
  gloss: null,
  stretch: false,
  deck: true,
  grammar: null,
});
const tokens = (...texts: string[]) => texts.map(w);

// 'Sí', ',', ' ', 'ya', ' ', 'lo', ' ', 'sé', '.'
const line = tokens('Sí', ',', ' ', 'ya', ' ', 'lo', ' ', 'sé', '.');
const thai = tokens('ฉัน', 'ไม่', 'รู้', 'เรื่อง', 'นี้');

describe('locate', () => {
  it('finds a word object by identity, not by its text', () => {
    const other = tokens('Me', ' ', 'lo', ' ', 'dijo');
    expect(locate([{ words: line }, { words: other }], other[2])).toEqual({ line: 1, index: 2 });
    expect(locate([{ words: line }], w('lo'))).toBeNull();
  });
});

describe('pickEnd', () => {
  const started: PhrasePick = { line: 1, start: 3, end: null };

  it('ends the phrase on a later or an earlier word in the same line', () => {
    expect(pickEnd(started, 1, 7)).toEqual({ line: 1, start: 3, end: 7 });
    expect(pickEnd(started, 1, 0)).toEqual({ line: 1, start: 3, end: 0 });
  });

  it('leaves the pick as it was for the first word again or another line', () => {
    expect(pickEnd(started, 1, 3)).toBe(started);
    expect(pickEnd(started, 2, 5)).toBe(started);
  });

  it('leaves a finished phrase alone', () => {
    const done: PhrasePick = { line: 1, start: 3, end: 7 };
    expect(pickEnd(done, 1, 5)).toBe(done);
  });
});

describe('phraseRange and phrasePart', () => {
  it('orders the ends whichever was tapped first', () => {
    expect(phraseRange({ line: 0, start: 7, end: 3 })).toEqual({ from: 3, to: 7 });
    expect(phraseRange({ line: 0, start: 3, end: null })).toBeNull();
  });

  it('places each piece in the phrase, spaces included, and nothing outside it or its line', () => {
    const pick: PhrasePick = { line: 0, start: 7, end: 3 };
    expect([2, 3, 4, 5, 7, 8].map((i) => phrasePart(pick, 0, i))).toEqual([null, 'first', 'middle', 'middle', 'last', null]);
    expect(phrasePart(pick, 1, 5)).toBeNull();
    expect(phrasePart({ line: 0, start: 3, end: null }, 0, 3)).toBeNull();
    expect(phrasePart(null, 0, 3)).toBeNull();
  });
});

describe('phraseText', () => {
  it('is the phrase as it appears in the line', () => {
    expect(phraseText(line, { line: 0, start: 3, end: 7 })).toBe('ya lo sé');
    expect(phraseText(line, { line: 0, start: 7, end: 0 })).toBe('Sí, ya lo sé');
  });

  it('joins Thai with no spaces, as it is written', () => {
    expect(phraseText(thai, { line: 0, start: 1, end: 2 })).toBe('ไม่รู้');
  });

  it('is empty until the last word is chosen', () => {
    expect(phraseText(line, { line: 0, start: 3, end: null })).toBe('');
  });
});
