import { expect, test } from 'vitest';
import type { GrammarPoint } from '../../src/reader/api';
import { grammarSummary, seenLine } from '../../src/reader/grammar';

const point = (id: string, state: GrammarPoint['state']): GrammarPoint => ({ id, name: id, note: '', state });

test('the summary says how many points are practiced and not known yet', () => {
  expect(grammarSummary([point('a', 'normal')])).toBe('Nothing chosen');
  expect(grammarSummary([point('a', 'unset')])).toBe('Nothing chosen');
  expect(grammarSummary([point('a', 'practice')])).toBe('Practicing 1 point');
  expect(grammarSummary([point('a', 'avoid'), point('b', 'avoid')])).toBe('2 not known yet');
  expect(grammarSummary([point('a', 'practice'), point('b', 'practice'), point('c', 'avoid')])).toBe(
    'Practicing 2 points, 1 not known yet',
  );
});

test('a language with no grammar points says so', () => {
  expect(grammarSummary([])).toBe('None for this language yet');
});

const NOW = new Date(2026, 10, 12, 9);
const seen = (texts: number, uses: number, last: string | null) => ({ texts, uses, last });

test("a point's line says how often it came up and when, by study day", () => {
  expect(seenLine(seen(9, 23, '2026-11-12T08:00'), 'practice', NOW, 4)).toBe('In 9 texts you read (23 times), last today');
  expect(seenLine(seen(1, 1, '2026-11-11T12:00'), 'normal', NOW, 4)).toBe('In 1 text you read (1 time), last yesterday');
  // 2 AM on the 12th still belongs to the 11th's study day.
  expect(seenLine(seen(2, 3, '2026-11-12T02:00'), 'normal', NOW, 4)).toBe('In 2 texts you read (3 times), last yesterday');
  expect(seenLine(seen(2, 3, '2026-11-03T12:00'), 'normal', NOW, 4, true)).toBe('In 2 texts you read, last 9 days ago');
  expect(seenLine(seen(0, 0, null), 'normal', NOW, 4)).toBe("Not in any text you've read yet");
});

test('a point not set says so first, and one not known says it is kept out', () => {
  expect(seenLine(seen(0, 0, null), 'unset', NOW, 4)).toBe("Not set. Not in any text you've read yet");
  expect(seenLine(seen(1, 1, '2026-11-07T12:00'), 'unset', NOW, 4)).toBe('Not set. In 1 text you read (1 time), last 5 days ago');
  expect(seenLine(seen(0, 0, null), 'avoid', NOW, 4)).toBe('Kept out of texts');
  expect(seenLine(seen(1, 1, '2026-11-10T12:00'), 'avoid', NOW, 4)).toBe('Kept out of texts. Slipped into 1 text you read, last 2 days ago');
});

test('a server without counts gives no line', () => {
  expect(seenLine(undefined, 'normal', NOW, 4)).toBeNull();
});
