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

  it("measures each word's typos against that word, so a short word in a phrase isn't swapped for another", () => {
    const eat = parseSubject({ ...vocabResource, data: { ...vocabResource.data, meanings: [{ meaning: 'To Eat', primary: true, accepted_answer: true }], auxiliary_meanings: [] } })!;
    for (const typed of ['to sit', 'to cut', 'to get', 'to hit']) expect(checkMeaning(eat, [], typed)).toEqual({ result: 'wrong' });
    expect(checkMeaning(eat, [], 'to eat')).toEqual({ result: 'correct' });
    const things = parseSubject({ ...vocabResource, data: { ...vocabResource.data, meanings: [{ meaning: 'Two Things', primary: true, accepted_answer: true }], auxiliary_meanings: [] } })!;
    expect(checkMeaning(things, [], 'six things')).toEqual({ result: 'wrong' });
    expect(checkMeaning(things, [], 'two thngs')).toEqual({ result: 'correct', close: true });
  });

  it('refuses a near miss that is another real word: numbers, weekdays, months and look-alikes', () => {
    const meaning = (m: string, whitelist: string[] = []) => parseSubject({
      ...vocabResource,
      data: {
        ...vocabResource.data,
        meanings: [{ meaning: m, primary: true, accepted_answer: true }],
        auxiliary_meanings: whitelist.map((w) => ({ meaning: w, type: 'whitelist' })),
      },
    })!;
    const cases: [string, string][] = [['Five', 'fire'], ['Sunday', 'monday'], ['Tuesday', 'thursday'], ['Month', 'mouth'], ['Eight', 'right'], ['Four', 'hour']];
    for (const [m, typed] of cases) {
      expect(checkMeaning(meaning(m), [], typed)).toEqual({ result: 'wrong' });
      // An exact match still counts, and so do the user's synonyms and WaniKani's whitelist.
      expect(checkMeaning(meaning(m), [], m.toLowerCase())).toEqual({ result: 'correct' });
      expect(checkMeaning(meaning(m), [typed], typed)).toEqual({ result: 'correct' });
      expect(checkMeaning(meaning(m, [typed]), [], typed)).toEqual({ result: 'correct' });
    }
    // In a phrase, only the word that must be exact is held to it.
    expect(checkMeaning(meaning('Five Things'), [], 'fire things')).toEqual({ result: 'wrong' });
    expect(checkMeaning(meaning('Five Things'), [], 'five thngs')).toEqual({ result: 'correct', close: true });
    // Split differently, the exact word still has to be there on both sides.
    expect(checkMeaning(meaning('Sunday Morning'), [], 'sunday mor ning')).toEqual({ result: 'correct', close: true });
    expect(checkMeaning(meaning('Sunday Morning'), [], 'monday mor ning')).toEqual({ result: 'wrong' });
    // Words outside the set keep their typo allowance.
    expect(checkMeaning(meaning('Mountain'), [], 'mountian')).toEqual({ result: 'correct', close: true });
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
