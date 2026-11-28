import { describe, expect, it } from 'vitest';
import type { WritingCheck } from '../../src/reader/api';
import { asksAnotherTry, checksBeforeShowing, verdictLine, wordsToUse } from '../../src/reader/production';
import { compareTyped } from '../../src/core/typedCompare';

const check = (over: Partial<WritingCheck>): WritingCheck => ({ verdict: 'almost', corrected: 'x', english: 'x', notes: ['one'], ...over });

describe('verdictLine', () => {
  it('says how it went', () => {
    expect(verdictLine(check({ verdict: 'right', notes: [] }))).toBe("Right. This is how it's said.");
    expect(verdictLine(check({}))).toBe('Almost. One thing to fix.');
    expect(verdictLine(check({ notes: ['a', 'b'] }))).toBe('Almost. 2 things to fix.');
    expect(verdictLine(check({ verdict: 'wrong' }))).toBe('Not quite.');
  });
  it('says when the word was left out', () => {
    expect(verdictLine(check({ used_word: false }))).toBe("Almost. It doesn't use the word yet.");
  });
});

describe('wordsToUse', () => {
  const words: Record<string, { word: string; meaning: string }> = {
    a: { word: 'narzędzie', meaning: 'tool' },
    b: { word: 'kot', meaning: 'cat' },
    c: { word: 'pies', meaning: '' },
  };
  it("offers each note answered while new, once, in the order it was first answered", () => {
    const answers = [
      { noteId: 'b', wasNew: true },
      { noteId: 'a', wasNew: false },
      { noteId: 'a', wasNew: true },
      { noteId: 'b', wasNew: true },
      { noteId: 'c', wasNew: true },
      { noteId: 'gone', wasNew: true },
    ];
    expect(wordsToUse(answers, (id) => words[id]).map((w) => w.word)).toEqual(['kot', 'narzędzie']);
  });
});

describe('checksBeforeShowing', () => {
  const sentence = 'Die Verletzung ist schnell geheilt.';
  it('asks first when the words differ, which can still be right', () => {
    expect(checksBeforeShowing('Die Verletzung heilte schnell.', compareTyped(sentence, 'Die Verletzung heilte schnell.'))).toBe(true);
  });
  it('shows the sentence at once for nothing typed, or its own words', () => {
    expect(checksBeforeShowing('  ', compareTyped(sentence, '  '))).toBe(false);
    expect(checksBeforeShowing('die verletzung ist schnell geheilt', compareTyped(sentence, 'die verletzung ist schnell geheilt'))).toBe(false);
  });
});

describe('asksAnotherTry', () => {
  it('holds the correction back on the first check of writing with mistakes', () => {
    expect(asksAnotherTry(check({ verdict: 'almost' }), 1)).toBe(true);
    expect(asksAnotherTry(check({ verdict: 'wrong' }), 1)).toBe(true);
    expect(asksAnotherTry(check({ verdict: 'almost', used_word: false }), 1)).toBe(true);
  });
  it("doesn't for a right answer, or once it has been tried again", () => {
    expect(asksAnotherTry(check({ verdict: 'right', notes: [] }), 1)).toBe(false);
    expect(asksAnotherTry(check({ verdict: 'almost' }), 2)).toBe(false);
    expect(asksAnotherTry(check({ verdict: 'wrong' }), 3)).toBe(false);
  });
});
