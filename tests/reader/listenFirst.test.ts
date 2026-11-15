import { expect, test } from 'vitest';
import { allHeard, listensFirst, listensNeeded } from '../../src/reader/listenFirst';

test('only a new text with audio opens hidden, and only with the setting on', () => {
  expect(listensFirst(true, 'shelf', false, true)).toBe(true);
  expect(listensFirst(true, 'topic', false, true)).toBe(true);
  expect(listensFirst(false, 'shelf', false, true)).toBe(false);
  expect(listensFirst(true, 'past', false, true)).toBe(false);
  expect(listensFirst(true, 'shelf', true, true)).toBe(false); // Play all
  expect(listensFirst(true, 'shelf', false, false)).toBe(false); // nothing to hear
});

test('the words show once every line with audio has played to its end', () => {
  const lines = [{ audio: true }, { audio: false }, { audio: true }];
  expect(allHeard(lines, new Map())).toBe(false);
  expect(allHeard(lines, new Map([[0, 1]]))).toBe(false);
  expect(allHeard(lines, new Map([[0, 1], [2, 1]]))).toBe(true);
  // A line with no audio is never waited for.
  expect(allHeard([{ audio: false }], new Map())).toBe(true);
});

test('twice means every line with audio has played twice', () => {
  const lines = [{ audio: true }, { audio: false }, { audio: true }];
  expect(listensNeeded(false)).toBe(1);
  expect(listensNeeded(true)).toBe(2);
  expect(allHeard(lines, new Map([[0, 1], [2, 1]]), 2)).toBe(false);
  expect(allHeard(lines, new Map([[0, 2], [2, 1]]), 2)).toBe(false);
  expect(allHeard(lines, new Map([[0, 2], [2, 2]]), 2)).toBe(true);
  // A line replayed by itself counts: the second listen need not be a second pass from the top.
  expect(allHeard(lines, new Map([[0, 3], [2, 2]]), 2)).toBe(true);
});
