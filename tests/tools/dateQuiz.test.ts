import { describe, expect, it } from 'vitest';
import { sayThaiDate } from '../../src/tools/thai/date';
import { acceptedForms, addDays, dateOptions, DATE_MODES, sameDate } from '../../src/tools/dateQuiz';

/** A repeatable stand-in for Math.random. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe('the ways to answer a date', () => {
  it('lists them in the order the screen offers them', () => {
    expect(DATE_MODES).toEqual(['say', 'pick', 'type', 'tap']);
  });
});

describe('the accepted forms of a date', () => {
  it('starts with the usual one and ends with the digits as written, with no repeats', () => {
    const forms = acceptedForms(sayThaiDate({ year: 2044, month: 6, day: 27 }, { weekday: true, year: true }));
    expect(forms[0].text).toBe('วันจันทร์ที่ยี่สิบเจ็ด มิถุนายน พ.ศ. สองพันห้าร้อยแปดสิบเจ็ด');
    expect(forms.at(-1)?.text).toBe('วันจันทร์ที่ 27 มิถุนายน พ.ศ. 2587');
    expect(new Set(forms.map((f) => f.text)).size).toBe(forms.length);
  });
});

describe('adding days', () => {
  it('crosses months and years in both directions', () => {
    expect(addDays({ year: 2026, month: 11, day: 30 }, 1)).toEqual({ year: 2026, month: 12, day: 1 });
    expect(addDays({ year: 2026, month: 12, day: 31 }, 2)).toEqual({ year: 2027, month: 1, day: 2 });
    expect(addDays({ year: 2028, month: 3, day: 1 }, -1)).toEqual({ year: 2028, month: 2, day: 29 });
    expect(addDays({ year: 2027, month: 1, day: 1 }, -3)).toEqual({ year: 2026, month: 12, day: 29 });
    expect(addDays({ year: 2026, month: 11, day: 12 }, 0)).toEqual({ year: 2026, month: 11, day: 12 });
  });
});

describe('the phrases offered for a date', () => {
  const june27 = { year: 2044, month: 6, day: 27 };
  const parts = { weekday: true, year: true };

  it('offers four different phrases, one of them the date`s own', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { options, correct } = dateOptions(june27, parts, sayThaiDate, seeded(seed));
      expect(options).toHaveLength(4);
      expect(new Set(options.map((o) => o.phrase.text)).size).toBe(4);
      expect(options[correct].phrase.text).toBe(sayThaiDate(june27, parts).everyday.text);
      expect(sameDate(options[correct].date, june27)).toBe(true);
    }
  });

  it('keeps each wrong phrase tied to the date it says', () => {
    const { options, correct } = dateOptions(june27, parts, sayThaiDate, seeded(7));
    options.forEach((o, i) => {
      expect(o.phrase.text).toBe(sayThaiDate(o.date, parts).everyday.text);
      if (i !== correct) expect(sameDate(o.date, june27)).toBe(false);
    });
  });

  it('offers a wrong year only when the year is said', () => {
    const withoutYear = { weekday: false, year: false };
    for (let seed = 1; seed <= 40; seed++) {
      const { options } = dateOptions(june27, withoutYear, sayThaiDate, seeded(seed));
      expect(options.every((o) => o.date.year === 2044 || o.date.month !== 6 || o.date.day !== 27 || true)).toBe(true);
      expect(options.filter((o) => o.date.year !== 2044)).toEqual([]);
    }
    const years = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) dateOptions(june27, parts, sayThaiDate, seeded(seed)).options.forEach((o) => years.add(o.date.year));
    expect(years.size).toBeGreaterThan(1);
  });

  it('works at the edges of a month and a year', () => {
    for (const d of [{ year: 2026, month: 1, day: 1 }, { year: 2026, month: 12, day: 31 }, { year: 2028, month: 2, day: 29 }]) {
      const { options } = dateOptions(d, parts, sayThaiDate, seeded(3));
      expect(new Set(options.map((o) => o.phrase.text)).size).toBe(4);
    }
  });
});
