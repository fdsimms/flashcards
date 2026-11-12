import { describe, expect, it } from 'vitest';
import { saySpanishDate } from '../../../src/tools/spanish/date';

const nov12 = { year: 2026, month: 11, day: 12 };
const all = { weekday: true, year: true };
const bare = { weekday: false, year: false };

describe('a date in Spanish', () => {
  it('says the weekday, the day, de and the month, de and the year', () => {
    const s = saySpanishDate(nov12, all);
    expect(s.everyday.text).toBe('jueves doce de noviembre de dos mil veintiséis');
    expect(s.also.map((p) => p.text)).toEqual(['el jueves doce de noviembre de dos mil veintiséis']);
    expect(s.written.text).toBe('jueves 12 de noviembre de 2026');
  });

  it('leaves the weekday and the year off when asked', () => {
    expect(saySpanishDate(nov12, bare).everyday.text).toBe('doce de noviembre');
    expect(saySpanishDate(nov12, bare).written.text).toBe('12 de noviembre');
    expect(saySpanishDate(nov12, { weekday: false, year: true }).everyday.text).toBe('doce de noviembre de dos mil veintiséis');
  });

  it('says the first as primero, with uno as another way', () => {
    const s = saySpanishDate({ year: 1958, month: 3, day: 1 }, all);
    expect(s.everyday.text).toBe('sábado primero de marzo de mil novecientos cincuenta y ocho');
    expect(s.also.map((p) => p.text)).toContain('sábado uno de marzo de mil novecientos cincuenta y ocho');
    expect(s.written.text).toBe('sábado 1 de marzo de 1958');
  });

  it('says days and years ending in one standing alone', () => {
    expect(saySpanishDate({ year: 2021, month: 1, day: 21 }, { weekday: false, year: true }).everyday.text).toBe('veintiuno de enero de dos mil veintiuno');
    expect(saySpanishDate({ year: 2001, month: 12, day: 31 }, { weekday: false, year: true }).everyday.text).toBe('treinta y uno de diciembre de dos mil uno');
  });

  it('refuses a day the month does not have', () => {
    expect(() => saySpanishDate({ year: 2026, month: 4, day: 31 }, all)).toThrow(RangeError);
  });
});
