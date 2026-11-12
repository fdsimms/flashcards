import { describe, expect, it } from 'vitest';
import { dayOrdinal, dayOrdinalGenitive, yearOrdinalGenitive } from '../../../src/tools/polish/numbers';
import { sayPolishDate } from '../../../src/tools/polish/date';

const nov12 = { year: 2026, month: 11, day: 12 };
const all = { weekday: true, year: true };
const none = { weekday: false, year: false };

describe('a date in Polish', () => {
  it('says the day as a masculine ordinal and the month in the genitive', () => {
    expect(sayPolishDate(nov12, none).everyday.text).toBe('dwunasty listopada');
    expect(sayPolishDate({ year: 2026, month: 1, day: 1 }, none).everyday.text).toBe('pierwszy stycznia');
    expect(sayPolishDate({ year: 2026, month: 5, day: 3 }, none).everyday.text).toBe('trzeci maja');
    expect(sayPolishDate({ year: 2026, month: 9, day: 21 }, none).everyday.text).toBe('dwudziesty pierwszy września');
  });

  it('adds the weekday and the year when asked', () => {
    expect(sayPolishDate(nov12, all).everyday.text).toBe('czwartek, dwunasty listopada dwa tysiące dwudziestego szóstego roku');
    expect(sayPolishDate(nov12, { weekday: true, year: false }).everyday.text).toBe('czwartek, dwunasty listopada');
    expect(sayPolishDate(nov12, { weekday: false, year: true }).everyday.text).toBe('dwunasty listopada dwa tysiące dwudziestego szóstego roku');
  });

  it('gives the "on" form, the day in the genitive and the weekday after w', () => {
    const on = sayPolishDate(nov12, all).also[0];
    expect(on.text).toBe('w czwartek, dwunastego listopada dwa tysiące dwudziestego szóstego roku');
    expect(on.note).toBe('Saying on which day');
    expect(sayPolishDate({ year: 2026, month: 11, day: 10 }, all).also[0].text).toMatch(/^we wtorek, dziesiątego listopada/);
    expect(sayPolishDate({ year: 2026, month: 11, day: 11 }, all).also[0].text).toMatch(/^w środę/);
    expect(sayPolishDate({ year: 2026, month: 11, day: 15 }, all).also[0].text).toMatch(/^w niedzielę/);
  });

  it('writes it with digits', () => {
    expect(sayPolishDate(nov12, all).written.text).toBe('czwartek, 12 listopada 2026 r.');
    expect(sayPolishDate(nov12, none).written.text).toBe('12 listopada');
    expect(sayPolishDate(nov12, none).everyday.roman).toBeUndefined();
  });

  it('refuses a day the month does not have', () => {
    expect(() => sayPolishDate({ year: 2025, month: 2, day: 29 }, none)).toThrow(RangeError);
  });
});

describe('Polish ordinals for dates', () => {
  it('says each day of the month, both parts of a compound as ordinals', () => {
    expect([2, 3, 7, 8, 20, 22, 30, 31].map(dayOrdinal)).toEqual([
      'drugi', 'trzeci', 'siódmy', 'ósmy', 'dwudziesty', 'dwudziesty drugi', 'trzydziesty', 'trzydziesty pierwszy',
    ]);
    expect([1, 2, 3, 12, 21, 30].map(dayOrdinalGenitive)).toEqual([
      'pierwszego', 'drugiego', 'trzeciego', 'dwunastego', 'dwudziestego pierwszego', 'trzydziestego',
    ]);
    expect(() => dayOrdinal(0)).toThrow(RangeError);
    expect(() => dayOrdinalGenitive(32)).toThrow(RangeError);
  });

  it('says a year with its thousands and hundreds cardinal', () => {
    expect(yearOrdinalGenitive(1950)).toBe('tysiąc dziewięćset pięćdziesiątego');
    expect(yearOrdinalGenitive(1987)).toBe('tysiąc dziewięćset osiemdziesiątego siódmego');
    expect(yearOrdinalGenitive(2000)).toBe('dwutysięcznego');
    expect(yearOrdinalGenitive(2001)).toBe('dwa tysiące pierwszego');
    expect(yearOrdinalGenitive(2013)).toBe('dwa tysiące trzynastego');
    expect(yearOrdinalGenitive(2049)).toBe('dwa tysiące czterdziestego dziewiątego');
    expect(yearOrdinalGenitive(1900)).toBe('tysiąc dziewięćsetnego');
    expect(() => yearOrdinalGenitive(10000)).toThrow(RangeError);
  });
});
