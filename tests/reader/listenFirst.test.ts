import { expect, test } from 'vitest';
import { allHeard, listensFirst } from '../../src/reader/listenFirst';

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
  expect(allHeard(lines, new Set())).toBe(false);
  expect(allHeard(lines, new Set([0]))).toBe(false);
  expect(allHeard(lines, new Set([0, 2]))).toBe(true);
  // A line with no audio is never waited for.
  expect(allHeard([{ audio: false }], new Set())).toBe(true);
});
