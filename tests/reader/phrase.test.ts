import { describe, expect, it } from 'vitest';
import type { Word } from '../../src/reader/api';
import { dragTo, locate, MAX_PHRASE_LINES, phrasePart, phraseRange, phraseText, popupSpace, reachableLines, roomIsBelow, wordUnder, type PhrasePick, type WordBox } from '../../src/reader/phrase';

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

const at = (line: number, index: number) => ({ line, index });
const pick = (sl: number, si: number, el: number, ei: number): PhrasePick => ({ start: at(sl, si), end: at(el, ei) });

describe('phraseRange and phrasePart', () => {
  it('orders the ends whichever was reached first', () => {
    expect(phraseRange(pick(0, 7, 0, 3))).toEqual({ from: at(0, 3), to: at(0, 7) });
    expect(phraseRange(pick(2, 1, 1, 5))).toEqual({ from: at(1, 5), to: at(2, 1) });
  });

  it('places each piece in the phrase, spaces included, and nothing outside it', () => {
    const p = pick(0, 7, 0, 3);
    expect([2, 3, 4, 5, 7, 8].map((i) => phrasePart(p, 0, i))).toEqual([null, 'first', 'middle', 'middle', 'last', null]);
    expect(phrasePart(p, 1, 5)).toBeNull();
    expect(phrasePart(null, 0, 3)).toBeNull();
  });

  it('runs on from the first line to the last, the lines between whole', () => {
    const p = pick(3, 2, 1, 4);
    expect(phrasePart(p, 1, 3)).toBeNull();
    expect(phrasePart(p, 1, 4)).toBe('first');
    expect(phrasePart(p, 1, 9)).toBe('middle');
    expect(phrasePart(p, 2, 0)).toBe('middle');
    expect(phrasePart(p, 3, 2)).toBe('last');
    expect(phrasePart(p, 3, 3)).toBeNull();
    expect(phrasePart(p, 0, 9)).toBeNull();
  });
});

describe('phraseText', () => {
  it('is the phrase as it appears in the line', () => {
    expect(phraseText([{ words: line }], pick(0, 3, 0, 7))).toBe('ya lo sé');
    expect(phraseText([{ words: line }], pick(0, 7, 0, 0))).toBe('Sí, ya lo sé');
  });

  it('joins Thai with no spaces, as it is written', () => {
    expect(phraseText([{ words: thai }], pick(0, 1, 0, 2))).toBe('ไม่รู้');
  });

  it('joins a phrase that runs on into the next line with a space', () => {
    const next = tokens('ผม', 'อยาก', 'ได้');
    expect(phraseText([{ words: thai }, { words: next }], pick(1, 1, 0, 3))).toBe('เรื่องนี้ ผมอยาก');
    expect(phraseText([{ words: line }, { words: thai }], pick(0, 3, 1, 1))).toBe('ya lo sé. ฉันไม่');
  });
});

describe('reachableLines', () => {
  it('is MAX_PHRASE_LINES either way, counting the line held, within the text', () => {
    expect(reachableLines(5, 20)).toEqual({ first: 5 - (MAX_PHRASE_LINES - 1), last: 5 + MAX_PHRASE_LINES - 1 });
    expect(reachableLines(0, 2)).toEqual({ first: 0, last: 1 });
  });
});

describe('wordUnder', () => {
  // Two rows of text: words 0, 2, 4 on the first, 6 and 8 on the second (the gaps are spaces).
  const boxes: WordBox[] = [
    { line: 0, index: 0, x: 0, y: 0, width: 40, height: 30 },
    { line: 0, index: 2, x: 50, y: 0, width: 40, height: 30 },
    { line: 0, index: 4, x: 100, y: 0, width: 40, height: 30 },
    { line: 1, index: 0, x: 0, y: 30, width: 60, height: 30 },
    { line: 1, index: 2, x: 70, y: 30, width: 40, height: 30 },
  ];

  it('is the word under the finger, in whichever line it is', () => {
    expect(wordUnder(boxes, 60, 10)).toEqual(at(0, 2));
    expect(wordUnder(boxes, 10, 45)).toEqual(at(1, 0));
  });

  it('keeps to the row the finger is on when it is between words or past the end', () => {
    expect(wordUnder(boxes, 47, 10)).toEqual(at(0, 2));
    expect(wordUnder(boxes, 300, 10)).toEqual(at(0, 4));
    expect(wordUnder(boxes, 300, 50)).toEqual(at(1, 2));
  });

  it('takes the nearest row when the finger is above or below the words', () => {
    expect(wordUnder(boxes, 110, -20)).toEqual(at(0, 4));
    expect(wordUnder(boxes, 80, 120)).toEqual(at(1, 2));
  });

  it('is null with nothing measured', () => {
    expect(wordUnder([], 10, 10)).toBeNull();
  });
});

describe('dragTo', () => {
  it('runs the phrase from where the drag started to the word reached, either way', () => {
    const held = pick(0, 3, 0, 3);
    expect(dragTo(held, at(0, 7))).toEqual(pick(0, 3, 0, 7));
    expect(dragTo(dragTo(held, at(0, 7)), at(0, 0))).toEqual(pick(0, 3, 0, 0));
  });

  it('goes on into the next lines, but no further than MAX_PHRASE_LINES', () => {
    const held = pick(4, 3, 4, 3);
    expect(dragTo(held, at(5, 1))).toEqual(pick(4, 3, 5, 1));
    expect(dragTo(held, at(4 + MAX_PHRASE_LINES - 1, 0))).toEqual(pick(4, 3, 4 + MAX_PHRASE_LINES - 1, 0));
    expect(dragTo(held, at(4 + MAX_PHRASE_LINES, 0))).toBe(held);
    expect(dragTo(held, at(4 - MAX_PHRASE_LINES, 0))).toBe(held);
  });

  it('leaves the pick as it was on the same word', () => {
    const held = pick(0, 3, 0, 5);
    expect(dragTo(held, at(0, 5))).toBe(held);
  });

  it('draws one word as the whole phrase while the finger is still on it', () => {
    expect(phrasePart(pick(0, 3, 0, 3), 0, 3)).toBe('only');
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
