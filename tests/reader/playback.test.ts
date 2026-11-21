import { expect, test } from 'vitest';
import { firstLine, lineAtX, nextLine, nextRepeatCount, paragraphs, playableNear, previousLine, rangeOf, repeatBadge, wrapsToStart } from '../../src/reader/playback';

const lines = [{ audio: false }, { audio: true }, { audio: false }, { audio: true }];

test('play starts at the first line that has audio', () => {
  expect(firstLine(lines)).toBe(1);
  expect(firstLine([{ audio: false }])).toBeNull();
});

test('playing the dialogue moves on, skipping silent lines, and stops at the end', () => {
  expect(nextLine(lines, 1, true)).toBe(3);
  expect(nextLine(lines, 3, true)).toBeNull();
});

test('a replayed line plays alone', () => {
  expect(nextLine(lines, 1, false)).toBeNull();
});

test('with a repeat count, the line plays again until it has played that many times', () => {
  const lines = [{ audio: true }, { audio: true }];
  expect(nextLine(lines, 0, true, 3, 1)).toBe(0);
  expect(nextLine(lines, 0, true, 3, 2)).toBe(0);
  expect(nextLine(lines, 0, true, 3, 3)).toBe(1);
  expect(nextLine(lines, 1, false, 2, 1)).toBe(1);
  expect(nextLine(lines, 1, false, 2, 2)).toBeNull();
  expect(nextLine(lines, 0, true, 1)).toBe(1);
});

test('repeating forever never moves on', () => {
  const lines = [{ audio: true }, { audio: true }];
  expect(nextLine(lines, 0, true, Infinity, 500)).toBe(0);
});

test('Loop text goes back to the first line with audio after the last, only while playing on', () => {
  expect(nextLine(lines, 3, true, 1, 1, true)).toBe(1);
  expect(nextLine(lines, 3, true, 1, 1, false)).toBeNull();
  expect(nextLine(lines, 3, false, 1, 1, true)).toBeNull();
  // Looping doesn't cut a line's repeats short, and doesn't loop in the middle of the text.
  expect(nextLine(lines, 3, true, 2, 1, true)).toBe(3);
  expect(nextLine(lines, 1, true, 1, 1, true)).toBe(3);
  // A text with a single line with audio plays that line again.
  expect(nextLine([{ audio: false }, { audio: true }], 1, true, 1, 1, true)).toBe(1);
});

test('the text wraps only when the last line has finished its repeats with Loop text on', () => {
  expect(wrapsToStart(lines, 3, true, 1, 1, true)).toBe(true);
  expect(wrapsToStart(lines, 3, true, 2, 1, true)).toBe(false);
  expect(wrapsToStart(lines, 3, true, 2, 2, true)).toBe(true);
  expect(wrapsToStart(lines, 1, true, 1, 1, true)).toBe(false);
  expect(wrapsToStart(lines, 3, true, 1, 1, false)).toBe(false);
  expect(wrapsToStart(lines, 3, false, 1, 1, true)).toBe(false);
});

test('the repeat chip steps through the counts and wraps back to off', () => {
  expect(nextRepeatCount(1)).toBe(2);
  expect(nextRepeatCount(3)).toBe(5);
  expect(nextRepeatCount(5)).toBe(Infinity);
  expect(nextRepeatCount(Infinity)).toBe(1);
  expect([null, '2', '3', '5', '∞']).toEqual([1, 2, 3, 5, Infinity].map(repeatBadge));
});

test('previous line skips silent lines and stops at the start', () => {
  const lines = [{ audio: true }, { audio: false }, { audio: true }];
  expect(previousLine(lines, 2)).toBe(0);
  expect(previousLine(lines, 0)).toBeNull();
});

test('paragraphs start at each marked line, and the first line always starts one', () => {
  const marks = (...p: boolean[]) => p.map((paragraph) => ({ paragraph }));
  expect(paragraphs(marks(true, false, true, false, false))).toEqual([{ start: 0, end: 1 }, { start: 2, end: 4 }]);
  expect(paragraphs(marks(false, false, true))).toEqual([{ start: 0, end: 1 }, { start: 2, end: 2 }]);
});

test('a text with no paragraph marks has no paragraphs', () => {
  expect(paragraphs([{}, {}])).toBeNull();
  expect(paragraphs([{ paragraph: false }])).toBeNull();
});

test('rangeOf finds the paragraph a line is in', () => {
  const ranges = [{ start: 0, end: 1 }, { start: 2, end: 4 }];
  expect(rangeOf(ranges, 1)).toBe(0);
  expect(rangeOf(ranges, 3)).toBe(1);
  expect(rangeOf(ranges, 9)).toBe(-1);
});

test('a finger on the line scrubber points at the line under it, kept inside the text', () => {
  expect(lineAtX(0, 120, 12)).toBe(0);
  expect(lineAtX(59, 120, 12)).toBe(5);
  expect(lineAtX(60, 120, 12)).toBe(6);
  expect(lineAtX(500, 120, 12)).toBe(11);
  expect(lineAtX(-20, 120, 12)).toBe(0);
  expect(lineAtX(10, 0, 12)).toBe(0);
});

test('a scrub lands on the nearest line with audio, ahead first and then behind', () => {
  expect(playableNear(lines, 0)).toBe(1);
  expect(playableNear(lines, 2)).toBe(3);
  expect(playableNear([{ audio: true }, { audio: false }], 1)).toBe(0);
  expect(playableNear([{ audio: false }], 0)).toBeNull();
});
