import { expect, test } from 'vitest';
import type { GrammarPoint } from '../../src/reader/api';
import { grammarSummary, practicingPoints, seenLine } from '../../src/reader/grammar';

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

test('a time the server sends with its offset is read as that instant, on the right study day', () => {
  // The server sends UTC with "+00:00"; noon local yesterday is yesterday in every zone.
  const yesterdayNoon = new Date(2026, 10, 11, 12).toISOString().replace('Z', '+00:00');
  expect(seenLine(seen(1, 1, yesterdayNoon), 'normal', NOW, 4)).toBe('In 1 text you read (1 time), last yesterday');
});

test('the points practiced in any language are the ones Forms practice asks first', async () => {
  const api = { grammarChoices: async () => ({ choices: { 'es.preterite': 'practice', 'es.future': 'avoid', 'pl.past': 'practice', 'th.ever': 'normal' } as const }) };
  expect([...await practicingPoints(api)].sort()).toEqual(['es.preterite', 'pl.past']);
});

test('without Read & Listen, or with its server down or slow, practice goes on without the choices', async () => {
  expect((await practicingPoints(null)).size).toBe(0);
  const down = { grammarChoices: async () => { throw new Error('offline'); } };
  expect((await practicingPoints(down)).size).toBe(0);
  const slow = { grammarChoices: () => new Promise<never>(() => undefined) };
  expect((await practicingPoints(slow, 5)).size).toBe(0);
});
