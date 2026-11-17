import { expect, test } from 'vitest';
import type { PastText } from '../../src/reader/api';
import { listenAgainCard, readAgo } from '../../src/reader/relisten';

// Local times, with the study day starting at 4 AM.
const text = (id: number, title: string, readAt: Date): PastText =>
  ({ id, topic: 'Food', title, rating: 'about_right', read_at: readAt.toISOString(), coverage: 0.93, form: 'dialogue' });

const NOW = new Date(2026, 10, 15, 12);

test('how long ago a text was read is counted in study days', () => {
  expect(readAgo(new Date(2026, 10, 15, 9).toISOString(), NOW, 4)).toBe('today');
  expect(readAgo(new Date(2026, 10, 14, 20).toISOString(), NOW, 4)).toBe('yesterday');
  expect(readAgo(new Date(2026, 10, 11, 20).toISOString(), NOW, 4)).toBe('4 days ago');
  // 2 AM on the 15th still belongs to the 14th's study day, so by noon it was read yesterday.
  expect(readAgo(new Date(2026, 10, 15, 2).toISOString(), new Date(2026, 10, 15, 12), 4)).toBe('yesterday');
  expect(readAgo('not a date', NOW, 4)).toBe('');
});

test('nothing due, no card', () => {
  expect(listenAgainCard([], NOW, 4)).toBeNull();
});

test('the row names the texts, when each was read, and what playing does', () => {
  const one = listenAgainCard([text(1, 'At the stall', new Date(2026, 10, 14, 20))], NOW, 4);
  expect(one).toEqual({ title: 'At the stall', detail: 'Read yesterday. Played with the words hidden.', play: 'Play it' });
  expect(listenAgainCard([{ ...text(1, 'At the stall', NOW), read_at: 'not a date' }], NOW, 4)?.detail).toBe('Played with the words hidden.');
  const two = listenAgainCard([text(1, 'At the stall', new Date(2026, 10, 14, 20)), text(2, 'The taxi ride', new Date(2026, 10, 11, 20))], NOW, 4);
  expect(two?.detail).toBe('"At the stall" (yesterday) and "The taxi ride" (4 days ago). Played with the words hidden.');
  expect(two?.title).toBe('2 texts');
  expect(two?.play).toBe('Play both');
  const three = listenAgainCard([1, 2, 3].map((i) => text(i, `T${i}`, new Date(2026, 10, 13, 12))), NOW, 4);
  expect(three?.title).toBe('3 texts');
  expect(three?.detail).toBe('"T1" (2 days ago), "T2" (2 days ago) and "T3" (2 days ago). Played with the words hidden.');
  expect(three?.play).toBe('Play all 3');
});
