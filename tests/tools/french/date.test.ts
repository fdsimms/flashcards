import { describe, expect, it } from 'vitest';
import { sayFrenchDate } from '../../../src/tools/french/date';

const nov12 = { year: 2026, month: 11, day: 12 };
const all = { weekday: true, year: true };
const bare = { weekday: false, year: false };

describe('a date in French', () => {
  it('says the weekday, the day, the month and the year', () => {
    const s = sayFrenchDate(nov12, all);
    expect(s.everyday.text).toBe('jeudi douze novembre deux mille vingt-six');
    expect(s.also.map((p) => p.text)).toEqual(['le jeudi douze novembre deux mille vingt-six']);
    expect(s.written.text).toBe('jeudi 12 novembre 2026');
  });

  it('leaves the weekday and the year off when asked', () => {
    expect(sayFrenchDate(nov12, bare).everyday.text).toBe('douze novembre');
    expect(sayFrenchDate(nov12, bare).also.map((p) => p.text)).toEqual(['le douze novembre']);
    expect(sayFrenchDate(nov12, { weekday: true, year: false }).written.text).toBe('jeudi 12 novembre');
  });

  it('says the first as premier, written 1er', () => {
    const s = sayFrenchDate({ year: 2026, month: 3, day: 1 }, { weekday: false, year: false });
    expect(s.everyday.text).toBe('premier mars');
    expect(s.written.text).toBe('1er mars');
  });

  it('says a year before 2000 in thousands, and in hundreds as another way', () => {
    const s = sayFrenchDate({ year: 1971, month: 8, day: 21 }, { weekday: false, year: true });
    expect(s.everyday.text).toBe('vingt et un août mille neuf cent soixante et onze');
    expect(s.also.map((p) => p.text)).toContain('vingt et un août dix-neuf cent soixante et onze');
    expect(sayFrenchDate({ year: 2001, month: 8, day: 21 }, { weekday: false, year: true }).also.map((p) => p.text)).toEqual(['le vingt et un août deux mille un']);
  });

  it('refuses a day the month does not have', () => {
    expect(() => sayFrenchDate({ year: 2026, month: 2, day: 29 }, all)).toThrow(RangeError);
  });
});
