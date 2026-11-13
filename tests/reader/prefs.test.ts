import { expect, test } from 'vitest';
import { DEFAULT_PREFS, parsePrefs } from '../../src/reader/prefs';

test('saved settings come back', () => {
  expect(parsePrefs(JSON.stringify({ rate: 0.7, highlight: true, markNames: false, paragraphs: false, thaiFont: 'loopless', followWords: false, shareCounts: true }))).toEqual({ rate: 0.7, highlight: true, markNames: false, paragraphs: false, thaiFont: 'loopless', followWords: false, shareCounts: true });
});

test('nothing saved, or something unreadable, gives the defaults', () => {
  expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
  expect(parsePrefs('not json')).toEqual(DEFAULT_PREFS);
  expect(parsePrefs('null')).toEqual(DEFAULT_PREFS);
});

test("a speed the reader doesn't offer falls back on its own", () => {
  expect(parsePrefs(JSON.stringify({ rate: 2, highlight: true }))).toEqual({ ...DEFAULT_PREFS, rate: 0.9, highlight: true });
  expect(parsePrefs(JSON.stringify({ rate: 0.8, highlight: 'yes' }))).toEqual({ ...DEFAULT_PREFS, rate: 0.8, highlight: false });
});

test('a Thai font the reader doesn\'t offer falls back to looped', () => {
  expect(parsePrefs(JSON.stringify({ thaiFont: 'comic' })).thaiFont).toBe('looped');
});

test('names are marked unless the reader turned that off', () => {
  expect(DEFAULT_PREFS.markNames).toBe(true);
  expect(parsePrefs(JSON.stringify({ markNames: false })).markNames).toBe(false);
  expect(parsePrefs(JSON.stringify({ markNames: 'no' })).markNames).toBe(true);
});

test('counts are sent to the server only once that is turned on', () => {
  expect(DEFAULT_PREFS.shareCounts).toBe(false);
  expect(parsePrefs(JSON.stringify({ shareCounts: 'yes' })).shareCounts).toBe(false);
  expect(parsePrefs(JSON.stringify({ shareCounts: true })).shareCounts).toBe(true);
});

test('the word being spoken is lit unless the reader turned that off', () => {
  expect(DEFAULT_PREFS.followWords).toBe(true);
  expect(parsePrefs(JSON.stringify({ followWords: false })).followWords).toBe(false);
  expect(parsePrefs(JSON.stringify({ followWords: 'no' })).followWords).toBe(true);
});
