import { describe, expect, it } from 'vitest';
import type { ReaderText, Word } from '../../src/reader/api';
import { aroundWord, checkForm, formReason, isSlotWord, markDecider, slotView, slotWidth, slotWords } from '../../src/reader/formQuiz';

const word = (text: string, over: Partial<Word> = {}): Word => ({
  text, status: 'known', gloss: null, stretch: false, deck: true, grammar: null, ...over,
});
const space = (): Word => ({ text: ' ', status: null, gloss: null, stretch: false, deck: false, grammar: null });
const mice = word('myszy', { lemma: 'mysz', gloss: 'mouse', quiz: true, form: { id: 'genitive', name: 'genitive case' } });
const line = [word('«Mysz!'), space(), word('Ja'), space(), word('nie'), space(), word('lubię'), space(), mice, word('!»', { status: null })];

describe('isSlotWord', () => {
  it('needs the flag, a dictionary form to start from and a form to explain', () => {
    expect(isSlotWord(mice)).toBe(true);
    expect(isSlotWord({ ...mice, quiz: undefined })).toBe(false);
    expect(isSlotWord({ ...mice, lemma: null })).toBe(false);
    expect(isSlotWord({ ...mice, form: null })).toBe(false);
  });
});

describe('slotWords', () => {
  it('lists the flagged words of the text in order', () => {
    const other = word('czapkę', { lemma: 'czapka', quiz: true, form: { id: 'accusative', name: 'accusative case' } });
    const text = { lines: [{ words: line }, { words: [word('Ona'), space(), other] }] } as unknown as ReaderText;
    expect(slotWords(text)).toEqual([mice, other]);
  });
});

describe('slotView', () => {
  it('is the pill while open, and the plain word where there is no slot', () => {
    expect(slotView(mice, undefined, true, false)).toBe('open');
    expect(slotView(word('lubię'), undefined, true, false)).toBeNull();
  });

  it('is the plain word with the quiz off', () => {
    expect(slotView(mice, undefined, false, false)).toBeNull();
  });

  it('shows the word while its line plays, then goes back to the pill', () => {
    expect(slotView(mice, undefined, true, true)).toBeNull();
    expect(slotView(mice, undefined, true, false)).toBe('open');
  });

  it('keeps a tint for a right answer and shows a missed or skipped word plainly', () => {
    expect(slotView(mice, 'right', true, false)).toBe('right');
    expect(slotView(mice, 'right', true, true)).toBe('right');
    expect(slotView(mice, 'missed', true, false)).toBeNull();
    expect(slotView(mice, 'skipped', true, false)).toBeNull();
  });
});

describe('slotWidth', () => {
  it('is about the width of the word, never under the minimum', () => {
    expect(slotWidth(word('myszy'), 20, 44)).toBe(60);
    expect(slotWidth(word('ją'), 20, 44)).toBe(44);
  });

  it('counts letters, not code units, and a full-width letter as a whole em', () => {
    expect(slotWidth(word('食べました'), 20, 44)).toBe(100);
    expect(slotWidth(word('Tokyoで'), 20, 44)).toBe(80);
  });
});

describe('aroundWord', () => {
  it('gives the line before and after the word, with its punctuation', () => {
    expect(aroundWord(line, mice)).toEqual({ before: '«Mysz! Ja nie lubię ', after: '!»' });
  });

  it('is null for a word that is not in the line', () => {
    expect(aroundWord(line, word('x'))).toBeNull();
  });
});

describe('checkForm', () => {
  it('is empty until something is typed', () => {
    expect(checkForm('', mice)).toBe('empty');
    expect(checkForm('   ', mice)).toBe('empty');
  });

  it('is right for the form in the text, whatever its case or spacing', () => {
    expect(checkForm('myszy', mice)).toBe('right');
    expect(checkForm('  Myszy ', mice)).toBe('right');
  });

  it('is wrong for the dictionary form or another form', () => {
    expect(checkForm('mysz', mice)).toBe('wrong');
    expect(checkForm('myszą', mice)).toBe('wrong');
  });

  it('tells apart the right letters with the accents wrong', () => {
    expect(checkForm('czapke', word('czapkę'))).toBe('accents');
    expect(checkForm('czapkę', word('czapkę'))).toBe('right');
  });

  it('takes a Japanese form as its reading, in kana or romaji', () => {
    const ate = word('食べました', { translit: 'たべました' });
    expect(checkForm('たべました', ate, 'ja')).toBe('right');
    expect(checkForm('tabemashita', ate, 'ja')).toBe('right');
    expect(checkForm('たべます', ate, 'ja')).toBe('wrong');
    expect(checkForm('たべました', ate)).toBe('wrong');
  });
});

describe('formReason', () => {
  it('names the form, and the word that goes with it when there is one', () => {
    expect(formReason(mice)).toBe('Genitive case.');
    expect(formReason({ form: { id: 'prep', name: 'prepositional case', helper: 'в', phrase: 'in hoods' } })).toBe(
      'Prepositional case. в + prepositional: in hoods.',
    );
  });

  it('is empty for a word with no form', () => {
    expect(formReason({ form: null })).toBe('');
  });
});

describe('markDecider', () => {
  const marked = (pieces: { text: string; mark: boolean }[]) => pieces.filter((p) => p.mark).map((p) => p.text);

  it('marks the deciding word before the blank and keeps every character', () => {
    const { before, after } = markDecider('Jeder bringt ', ' Kuchen.', 'bringt');
    expect(marked(before)).toEqual(['bringt']);
    expect(before.map((p) => p.text).join('')).toBe('Jeder bringt ');
    expect(marked(after)).toEqual([]);
    expect(after.map((p) => p.text).join('')).toBe(' Kuchen.');
  });

  it('marks it after the blank when it is only there', () => {
    const { before, after } = markDecider('Ich ', ' dem Mann.', 'dem');
    expect(marked(before)).toEqual([]);
    expect(marked(after)).toEqual(['dem']);
  });

  it('takes the nearest occurrence before the blank', () => {
    const { before } = markDecider('Er sagt, er sagt ', '.', 'sagt');
    expect(before.map((p) => p.text)).toEqual(['Er sagt, er ', 'sagt', ' ']);
    expect(before.map((p) => p.mark)).toEqual([false, true, false]);
  });

  it('needs a whole word where the script has spaces', () => {
    const { before, after } = markDecider('Wir sehen ', ' einen Hund.', 'ein');
    expect([...before, ...after].some((p) => p.mark)).toBe(false);
  });

  it('finds a word inside text with no spaces', () => {
    const { before } = markDecider('私は日本語を', 'ます', '日本語');
    expect(marked(before)).toEqual(['日本語']);
  });

  it('marks nothing for an empty or missing deciding word', () => {
    expect(markDecider('A ', ' b', '')).toEqual({ before: [{ text: 'A ', mark: false }], after: [{ text: ' b', mark: false }] });
    expect(markDecider('', '', 'x')).toEqual({ before: [], after: [] });
  });
});
