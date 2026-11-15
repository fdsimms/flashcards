import { expect, test } from 'vitest';
import { DEFAULT_PREFS, parsePrefs } from '../../src/reader/prefs';

test('saved settings come back', () => {
  expect(parsePrefs(JSON.stringify({ rate: 0.8, highlight: true, markNames: false, paragraphs: false, thaiFont: 'loopless', textSize: 'larger', followWords: false, shareCounts: true, hiddenMarks: ['stretch', 'marked'], checkEnglish: true, guessFirst: false, quizKnown: true, listenFirst: true, listenTwice: true, listenAgain: 3, situationsAzure: true }))).toEqual({ rate: 0.8, highlight: true, markNames: false, paragraphs: false, thaiFont: 'loopless', textSize: 'larger', followWords: false, shareCounts: true, hiddenMarks: ['stretch', 'marked'], checkEnglish: true, guessFirst: false, quizKnown: true, listenFirst: true, listenTwice: true, listenAgain: 3, situationsAzure: true });
});

test('nothing saved, or something unreadable, gives the defaults', () => {
  expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
  expect(parsePrefs('not json')).toEqual(DEFAULT_PREFS);
  expect(parsePrefs('null')).toEqual(DEFAULT_PREFS);
});

test("a speed the reader doesn't offer falls back on its own", () => {
  expect(parsePrefs(JSON.stringify({ rate: 2, highlight: true }))).toEqual({ ...DEFAULT_PREFS, rate: 1, highlight: true });
  expect(parsePrefs(JSON.stringify({ rate: 0.8, highlight: 'yes' }))).toEqual({ ...DEFAULT_PREFS, rate: 0.8, highlight: false });
  // One of the four speeds the reader once offered below normal is slow now.
  expect(parsePrefs(JSON.stringify({ rate: 0.7 })).rate).toBe(0.8);
  expect(parsePrefs(JSON.stringify({ rate: 0.9 })).rate).toBe(0.8);
});

test('a Thai font the reader doesn\'t offer falls back to looped', () => {
  expect(parsePrefs(JSON.stringify({ thaiFont: 'comic' })).thaiFont).toBe('looped');
});

test('a text size the reader does not offer falls back to the default', () => {
  expect(parsePrefs(JSON.stringify({ textSize: 'huge' })).textSize).toBe('default');
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

test('every mark shows unless the reader switched it off, and an unknown one is dropped', () => {
  expect(DEFAULT_PREFS.hiddenMarks).toEqual([]);
  expect(parsePrefs(JSON.stringify({ hiddenMarks: ['known', 'sparkle', 'practice', 'known'] })).hiddenMarks).toEqual(['practice', 'known']);
  expect(parsePrefs(JSON.stringify({ hiddenMarks: 'known' })).hiddenMarks).toEqual([]);
});

test('guessing before the meaning is on and the quiz off until chosen', () => {
  expect(DEFAULT_PREFS.guessFirst).toBe(true);
  expect(DEFAULT_PREFS.quizKnown).toBe(false);
  expect(parsePrefs(JSON.stringify({ guessFirst: false })).guessFirst).toBe(false);
  expect(parsePrefs(JSON.stringify({ quizKnown: true })).quizKnown).toBe(true);
  expect(parsePrefs(JSON.stringify({ guessFirst: 'no', quizKnown: 1 }))).toMatchObject({ guessFirst: true, quizKnown: false });
});

test('listening before reading is off until chosen', () => {
  expect(DEFAULT_PREFS.listenFirst).toBe(false);
  expect(parsePrefs(JSON.stringify({ listenFirst: true })).listenFirst).toBe(true);
  expect(parsePrefs(JSON.stringify({ listenFirst: 'yes' })).listenFirst).toBe(false);
});

test('listening twice before reading is off until chosen', () => {
  expect(DEFAULT_PREFS.listenTwice).toBe(false);
  expect(parsePrefs(JSON.stringify({ listenTwice: true })).listenTwice).toBe(true);
  expect(parsePrefs(JSON.stringify({ listenTwice: 2 })).listenTwice).toBe(false);
});

test('a finished text is offered to hear again once unless chosen otherwise', () => {
  expect(DEFAULT_PREFS.listenAgain).toBe(1);
  expect(parsePrefs(JSON.stringify({ listenAgain: 0 })).listenAgain).toBe(0);
  expect(parsePrefs(JSON.stringify({ listenAgain: 3 })).listenAgain).toBe(3);
  // Two isn't a choice, and anything else falls back.
  expect(parsePrefs(JSON.stringify({ listenAgain: 2 })).listenAgain).toBe(1);
  expect(parsePrefs(JSON.stringify({ listenAgain: 'three' })).listenAgain).toBe(1);
});
