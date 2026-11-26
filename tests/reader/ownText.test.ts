import { describe, expect, it } from 'vitest';
import { charCount, costText, coverageNote, listenTime, moreNewWords, newWordsTitle, partsNote, percentKnown, tooLong, untranslated } from '../../src/reader/ownText';

describe("a pasted text's preview", () => {
  it('counts the characters against the limit', () => {
    expect(charCount(1240)).toBe('1,240 of 30,000 characters');
    expect(tooLong(30_000)).toBe(false);
    expect(tooLong(30_001)).toBe(true);
  });

  it("rounds the known share down, and says what a share below the written texts' means", () => {
    expect(percentKnown({ coverage: 0.896 })).toBe('89%');
    expect(coverageNote({ coverage: 0.896 })).toMatch(/at least 90%/);
    expect(coverageNote({ coverage: 0.9 })).toBeNull();
  });

  it('names the new words, and how many the list leaves out', () => {
    expect(newWordsTitle({ new_count: 0 })).toBe('You know every word in it');
    expect(newWordsTitle({ new_count: 1 })).toBe("1 word you haven't studied");
    expect(newWordsTitle({ new_count: 31 })).toBe("31 words you haven't studied");
    expect(moreNewWords({ new_count: 31, new_words: ['a', 'b'] })).toBe(29);
    expect(moreNewWords({ new_count: 2, new_words: ['a', 'b'] })).toBe(0);
  });

  it('gives the time, the cost and the parts in words', () => {
    expect(listenTime(20)).toBe('About 1 min');
    expect(listenTime(250)).toBe('About 4 min');
    expect(costText(0.001)).toBe('Less than a cent');
    expect(costText(0.034)).toBe('About $0.03');
    expect(partsNote({ parts: 1 })).toBeNull();
    expect(partsNote({ parts: 3 })).toMatch(/3 parts/);
  });

  it("says when a pasted text came back with no English, and only then", () => {
    const lines = (...english: string[]) => english.map((e) => ({ english: e }));
    expect(untranslated({ reason: 'own', lines: lines('', ' ') })).toBe(true);
    expect(untranslated({ reason: 'own', lines: lines('', 'I want rice') })).toBe(false);
    expect(untranslated({ reason: 'asked', lines: lines('') })).toBe(false);
    expect(untranslated({ reason: 'own', lines: [] })).toBe(false);
  });
});
