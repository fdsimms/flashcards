import { expect, test } from 'vitest';
import { listenAgainPlay, readAgo } from '../../src/reader/relisten';

// Local times, with the study day starting at 4 AM.
const NOW = new Date(2026, 10, 15, 12);

test('how long ago a text was read is counted in study days', () => {
  expect(readAgo(new Date(2026, 10, 15, 9).toISOString(), NOW, 4)).toBe('today');
  expect(readAgo(new Date(2026, 10, 14, 20).toISOString(), NOW, 4)).toBe('yesterday');
  expect(readAgo(new Date(2026, 10, 11, 20).toISOString(), NOW, 4)).toBe('4 days ago');
  // 2 AM on the 15th still belongs to the 14th's study day, so by noon it was read yesterday.
  expect(readAgo(new Date(2026, 10, 15, 2).toISOString(), new Date(2026, 10, 15, 12), 4)).toBe('yesterday');
  expect(readAgo('not a date', NOW, 4)).toBe('');
});

test("the row's Play button says how many it plays", () => {
  expect(listenAgainPlay(1)).toBe('Play it');
  expect(listenAgainPlay(2)).toBe('Play both');
  expect(listenAgainPlay(3)).toBe('Play all 3');
});
