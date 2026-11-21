import { describe, expect, it } from 'vitest';
import type { InputTime } from '../../src/reader/api';
import { inputRowLabel, inputRows } from '../../src/reader/inputTime';

const NOW = new Date(2026, 10, 21, 12);
const time = (languages: InputTime['languages']): InputTime => ({ days: 7, languages });
const lang = (language: InputTime['languages'][number]['language'], reading_seconds: number, listening_seconds: number, last_read_at: string | null = null) =>
  ({ language, reading_seconds, listening_seconds, last_read_at });

describe('inputRows', () => {
  it('names each language with its time, and sizes the bars against the longest', () => {
    const rows = inputRows(time([lang('th', 1500, 1380), lang('es', 900, 360)]), NOW);
    expect(rows.map((r) => [r.name, r.total])).toEqual([['Thai', '48 min'], ['Spanish', '21 min']]);
    expect(rows[0].reading + rows[0].listening).toBeCloseTo(1);
    expect(rows[1].reading).toBeCloseTo(900 / 2880);
    expect(rows[1].listening).toBeCloseTo(360 / 2880);
    expect(rows.every((r) => r.note === '')).toBe(true);
  });

  it('says when a language with no time this week was last read', () => {
    const rows = inputRows(time([
      lang('pl', 0, 0, new Date(2026, 10, 5, 9).toISOString()),
      lang('de', 0, 0, new Date(2026, 10, 20, 9).toISOString()),
      lang('ru', 0, 0, new Date(2026, 10, 21, 9).toISOString()),
      lang('fr', 0, 0, null),
    ]), NOW);
    expect(rows.map((r) => [r.total, r.note])).toEqual([
      ['0 min', 'Last read 16 days ago'], ['0 min', 'Last read 1 day ago'], ['0 min', 'Last read less than a day ago'], ['0 min', ''],
    ]);
    expect(rows.every((r) => r.reading === 0 && r.listening === 0)).toBe(true);
  });

  it('writes short and long times plainly', () => {
    expect(inputRows(time([lang('th', 40, 0)]), NOW)[0].total).toBe('Under 1 min');
    expect(inputRows(time([lang('th', 3600, 1500)]), NOW)[0].total).toBe('1 h 25 min');
    expect(inputRows(time([]), NOW)).toEqual([]);
  });

  it('says a row aloud with its parts', () => {
    const l = lang('th', 1500, 1380);
    expect(inputRowLabel(inputRows(time([l]), NOW)[0], l)).toBe('Thai, 48 min. 25 min reading, 23 min listening');
    const idle = lang('pl', 0, 0, new Date(2026, 10, 5, 9).toISOString());
    expect(inputRowLabel(inputRows(time([idle]), NOW)[0], idle)).toBe('Polish, 0 min. Last read 16 days ago');
  });
});
