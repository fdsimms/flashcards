import { describe, expect, it } from 'vitest';
import { checkMeaning, checkReading, levenshtein, normalizeMeaning, typoAllowance } from '../../src/wanikani/answers';
import { parseSubject } from '../../src/wanikani/subjects';
import { kanjiResource, vocabResource } from './fixtures';

const vocab = parseSubject(vocabResource)!;
const kanji = parseSubject(kanjiResource)!;

describe('meanings', () => {
  it('accepts any accepted meaning, ignoring case, spaces and punctuation', () => {
    expect(checkMeaning(vocab, [], 'adult')).toEqual({ result: 'correct' });
    expect(checkMeaning(vocab, [], '  Grown-up ')).toEqual({ result: 'correct' });
  });

  it('accepts whitelisted extras and the user\'s own synonyms', () => {
    expect(checkMeaning(vocab, [], 'mature person')).toEqual({ result: 'correct' });
    expect(checkMeaning(vocab, ['big kid'], 'big kid')).toEqual({ result: 'correct' });
  });

  it('marks a meaning WaniKani lists but does not accept as wrong, though a typo away from a right one', () => {
    expect(checkMeaning(vocab, [], 'grownup')).toEqual({ result: 'wrong' });
  });

  it('marks a blacklisted meaning wrong, however close', () => {
    expect(checkMeaning(vocab, [], 'big person')).toEqual({ result: 'wrong' });
  });

  it('allows a typo on a longer word but not a short one', () => {
    expect(checkMeaning(vocab, [], 'adlt')).toEqual({ result: 'correct', close: true });
    expect(checkMeaning(kanji, [], 'powr')).toEqual({ result: 'correct', close: true });
    expect(checkMeaning(vocab, [], 'child')).toEqual({ result: 'wrong' });
  });

  it('asks again for kana typed as a meaning, or nothing at all', () => {
    expect(checkMeaning(vocab, [], 'おとな').result).toBe('retry');
    expect(checkMeaning(vocab, [], '  ').result).toBe('retry');
  });

  it('measures typos', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('', 'abc')).toBe(3);
    expect(typoAllowance(3)).toBe(0);
    expect(typoAllowance(5)).toBe(1);
    expect(typoAllowance(7)).toBe(2);
    expect(typoAllowance(14)).toBe(4);
    expect(normalizeMeaning("One's  Own-Self!")).toBe('one s own self');
  });
});

describe('readings', () => {
  it('accepts the reading in kana, romaji or katakana', () => {
    expect(checkReading(vocab, 'おとな')).toEqual({ result: 'correct' });
    expect(checkReading(vocab, 'otona')).toEqual({ result: 'correct' });
    expect(checkReading(vocab, 'オトナ')).toEqual({ result: 'correct' });
  });

  it('allows no typos in a reading', () => {
    expect(checkReading(vocab, 'おとの')).toEqual({ result: 'wrong' });
  });

  it("finishes a trailing n when the answer's submitted", () => {
    expect(checkReading({ ...vocab, readings: [{ reading: 'ほん', primary: true, accepted: true }] }, 'hon')).toEqual({ result: 'correct' });
  });

  it("asks again for a kanji's reading WaniKani isn't teaching", () => {
    expect(checkReading(kanji, 'りき')).toEqual({ result: 'correct' });
    const v = checkReading(kanji, 'ちから');
    expect(v.result).toBe('retry');
    expect(v.result === 'retry' && v.message).toContain("on'yomi");
  });

  it('asks again for something that is not kana', () => {
    expect(checkReading(vocab, 'adult').result).toBe('retry');
    expect(checkReading(vocab, '').result).toBe('retry');
  });
});
