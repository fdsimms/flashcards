import { describe, expect, it } from 'vitest';
import { norwegianYear, sayNorwegianDate } from '../../../src/tools/norwegian/date';
import { norwegianOrdinal } from '../../../src/tools/norwegian/numbers';

const nov12 = { year: 2026, month: 11, day: 12 };
const all = { weekday: true, year: true };
const none = { weekday: false, year: false };

describe('a date in Norwegian', () => {
  it('says the ordinal day and the month, with the weekday and year when asked', () => {
    expect(sayNorwegianDate(nov12, all).everyday.text).toBe('torsdag tolvte november totusenogtjueseks');
    expect(sayNorwegianDate(nov12, none).everyday.text).toBe('tolvte november');
    expect(sayNorwegianDate(nov12, { weekday: true, year: false }).everyday.text).toBe('torsdag tolvte november');
    expect(sayNorwegianDate(nov12, { weekday: false, year: true }).everyday.text).toBe('tolvte november totusenogtjueseks');
  });

  it('forms the ordinals', () => {
    expect([1, 2, 3, 4, 7, 11, 12, 20, 21, 22, 23, 30, 31].map(norwegianOrdinal)).toEqual([
      'første', 'andre', 'tredje', 'fjerde', 'sjuende', 'ellevte', 'tolvte', 'tjuende', 'tjueførste', 'tjueandre', 'tjuetredje', 'trettiende', 'trettiførste',
    ]);
  });

  it('says years in hundreds before 2000 and in thousands from it', () => {
    expect(norwegianYear(1950)).toBe('nittenhundreogfemti');
    expect(norwegianYear(1900)).toBe('nittenhundre');
    expect(norwegianYear(2000)).toBe('totusen');
    expect(norwegianYear(2001)).toBe('totusenogen');
    expect(norwegianYear(2049)).toBe('totusenogførtini');
    expect(() => norwegianYear(999)).toThrow(RangeError);
  });

  it('gives den before the day, and the year shortened', () => {
    expect(sayNorwegianDate(nov12, all).also.map((p) => p.text)).toEqual([
      'torsdag den tolvte november totusenogtjueseks',
      'torsdag tolvte november tjuetjueseks',
    ]);
    expect(sayNorwegianDate({ year: 1985, month: 5, day: 17 }, none).also.map((p) => p.text)).toEqual(['den syttende mai']);
    expect(sayNorwegianDate({ year: 1985, month: 5, day: 17 }, { weekday: false, year: true }).also.map((p) => p.text)).toEqual([
      'den syttende mai nittenhundreogåttifem', 'syttende mai nittenåttifem',
    ]);
    expect(sayNorwegianDate({ year: 2005, month: 5, day: 17 }, { weekday: false, year: true }).also).toHaveLength(1);
    expect(sayNorwegianDate({ year: 1950, month: 1, day: 1 }, { weekday: false, year: true }).also[1].text).toBe('første januar nittenfemti');
    expect(sayNorwegianDate({ year: 1905, month: 1, day: 1 }, { weekday: false, year: true }).also).toHaveLength(1);
  });

  it('writes the day with a dot', () => {
    expect(sayNorwegianDate(nov12, all).written.text).toBe('torsdag 12. november 2026');
    expect(sayNorwegianDate(nov12, none).written.text).toBe('12. november');
  });

  it('refuses a date that does not exist', () => {
    expect(() => sayNorwegianDate({ year: 2026, month: 4, day: 31 }, none)).toThrow(RangeError);
  });
});
