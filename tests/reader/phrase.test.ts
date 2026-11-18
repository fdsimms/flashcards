import { describe, expect, it } from 'vitest';
import type { Word } from '../../src/reader/api';
import { dragTo, locate, phrasePart, phraseRange, phraseText, popupSpace, roomIsBelow, wordUnder, type PhrasePick, type WordBox } from '../../src/reader/phrase';

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

describe('phraseRange and phrasePart', () => {
  it('orders the ends whichever was tapped first', () => {
    expect(phraseRange({ line: 0, start: 7, end: 3 })).toEqual({ from: 3, to: 7 });
  });

  it('places each piece in the phrase, spaces included, and nothing outside it or its line', () => {
    const pick: PhrasePick = { line: 0, start: 7, end: 3 };
    expect([2, 3, 4, 5, 7, 8].map((i) => phrasePart(pick, 0, i))).toEqual([null, 'first', 'middle', 'middle', 'last', null]);
    expect(phrasePart(pick, 1, 5)).toBeNull();
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
});

describe('wordUnder', () => {
  // Two rows of text: words 0, 2, 4 on the first, 6 and 8 on the second (the gaps are spaces).
  const boxes: WordBox[] = [
    { index: 0, x: 0, y: 0, width: 40, height: 30 },
    { index: 2, x: 50, y: 0, width: 40, height: 30 },
    { index: 4, x: 100, y: 0, width: 40, height: 30 },
    { index: 6, x: 0, y: 30, width: 60, height: 30 },
    { index: 8, x: 70, y: 30, width: 40, height: 30 },
  ];

  it('is the word under the finger', () => {
    expect(wordUnder(boxes, 60, 10)).toBe(2);
    expect(wordUnder(boxes, 10, 45)).toBe(6);
  });

  it('keeps to the row the finger is on when it is between words or past the end', () => {
    expect(wordUnder(boxes, 47, 10)).toBe(2);
    expect(wordUnder(boxes, 300, 10)).toBe(4);
    expect(wordUnder(boxes, 300, 50)).toBe(8);
  });

  it('takes the nearest row when the finger is above or below the line', () => {
    expect(wordUnder(boxes, 110, -20)).toBe(4);
    expect(wordUnder(boxes, 80, 120)).toBe(8);
  });

  it('is null with nothing measured', () => {
    expect(wordUnder([], 10, 10)).toBeNull();
  });
});

describe('dragTo', () => {
  it('runs the phrase from where the drag started to the word reached, either way', () => {
    const held: PhrasePick = { line: 0, start: 3, end: 3 };
    expect(dragTo(held, 7)).toEqual({ line: 0, start: 3, end: 7 });
    expect(dragTo(dragTo(held, 7), 0)).toEqual({ line: 0, start: 3, end: 0 });
  });

  it('leaves the pick as it was on the same word', () => {
    const held: PhrasePick = { line: 0, start: 3, end: 5 };
    expect(dragTo(held, 5)).toBe(held);
  });

  it('draws one word as the whole phrase while the finger is still on it', () => {
    expect(phrasePart({ line: 0, start: 3, end: 3 }, 0, 3)).toBe('only');
  });
});

describe('popupSpace', () => {
  const base = { windowHeight: 800, insetTop: 50, insetBottom: 30, keyboard: 0, typing: false, gap: 12, edge: 8, share: 0.6 };
  const anchor = { top: 200, bottom: 240 };

  it('opens on the side chosen, capped at its share of the window', () => {
    expect(popupSpace({ ...base, anchor, below: true })).toEqual({ side: 'below', maxHeight: 480 });
    expect(popupSpace({ ...base, anchor, below: false })).toEqual({ side: 'above', maxHeight: 130 });
  });

  it('is never taller than the room on its side', () => {
    expect(popupSpace({ ...base, anchor: { top: 600, bottom: 700 }, below: true }).maxHeight).toBe(50);
    expect(popupSpace({ ...base, anchor: { top: 10, bottom: 50 }, below: false }).maxHeight).toBe(0);
  });

  it('goes to the top while typing and takes what the keyboard leaves', () => {
    expect(popupSpace({ ...base, anchor, below: true, typing: true, keyboard: 300 })).toEqual({ side: 'top', maxHeight: 430 });
  });

  it('keeps the home indicator clear when typing with no keyboard up', () => {
    expect(popupSpace({ ...base, anchor, below: false, typing: true }).maxHeight).toBe(700);
  });
});

describe('roomIsBelow', () => {
  it('compares the room under the phrase with the room over it', () => {
    expect(roomIsBelow({ top: 200, bottom: 240 }, 800, 50, 30)).toBe(true);
    expect(roomIsBelow({ top: 600, bottom: 640 }, 800, 50, 30)).toBe(false);
  });
});
