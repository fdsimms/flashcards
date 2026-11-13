import { expect, test } from 'vitest';
import { COMMON_COUNTS, LANGUAGE_ORDER, LANGUAGES, commonLabel, commonNamed, flaggedName, languageNamed, meaningOf, wordStatus } from '../../src/reader/languages';

test("a word's meaning is its gloss, else its parts labeled as parts, never as its meaning", () => {
  expect(meaningOf({ gloss: 'to understand', parts: null })).toBe('to understand');
  expect(meaningOf({ gloss: null, parts: 'to enter + heart' })).toBe('Parts: to enter + heart');
  expect(meaningOf({ gloss: null })).toBe('No meaning available');
  expect(meaningOf({ gloss: '', parts: '' })).toBe('No meaning available');
});

test("a word says whether it's a deck word, a common word, or neither", () => {
  expect(wordStatus({ status: 'known', deck: true })).toBe('In your deck');
  expect(wordStatus({ status: 'known', deck: false })).toBe('A common word');
  expect(wordStatus({ status: 'known', deck: false, wanikani: true })).toBe('Learned in WaniKani');
  expect(wordStatus({ status: 'name', deck: false })).toBe('A name');
  expect(wordStatus({ status: 'partial', deck: false })).toBe('Only inside a longer phrase in your deck');
  expect(wordStatus({ status: 'unknown', deck: false })).toBe('Not in your deck');
});

test('every language is offered once and found again by its name', () => {
  expect(new Set(LANGUAGE_ORDER).size).toBe(Object.keys(LANGUAGES).length);
  for (const code of LANGUAGE_ORDER) expect(languageNamed(LANGUAGES[code].name)).toBe(code);
  expect(languageNamed('Klingon')).toBeUndefined();
});

test('a common-words count is shown with a thousands separator, and none as None', () => {
  expect(COMMON_COUNTS.map(commonLabel)).toEqual(['None', '250', '500', '1,000', '2,000', '3,000', '5,000', '10,000']);
  for (const count of COMMON_COUNTS) expect(commonNamed(commonLabel(count))).toBe(count);
});

test('every language has its own flag, shown before its name', () => {
  const flags = LANGUAGE_ORDER.map((code) => LANGUAGES[code].flag);
  expect(new Set(flags).size).toBe(LANGUAGE_ORDER.length);
  expect(flaggedName('th')).toBe('🇹🇭 Thai');
});
