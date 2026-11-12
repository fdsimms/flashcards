import { describe, expect, it } from 'vitest';
import { dayOrdinal, dayOrdinalGenitive, yearOrdinalGenitive } from '../../../src/tools/russian/numbers';
import { sayRussianDate } from '../../../src/tools/russian/date';

const nov12 = { year: 2026, month: 11, day: 12 };
const all = { weekday: true, year: true };
const none = { weekday: false, year: false };

describe('a date in Russian', () => {
  it('says the day as a neuter ordinal and the month in the genitive', () => {
    expect(sayRussianDate(nov12, none).everyday.text).toBe('двенадцатое ноября');
    expect(sayRussianDate({ year: 2026, month: 1, day: 1 }, none).everyday.text).toBe('первое января');
    expect(sayRussianDate({ year: 2026, month: 3, day: 3 }, none).everyday.text).toBe('третье марта');
    expect(sayRussianDate({ year: 2026, month: 5, day: 21 }, none).everyday.text).toBe('двадцать первое мая');
    expect(sayRussianDate({ year: 2026, month: 8, day: 30 }, none).everyday.text).toBe('тридцатое августа');
  });

  it('adds the weekday and the year when asked', () => {
    expect(sayRussianDate(nov12, all).everyday.text).toBe('четверг, двенадцатое ноября две тысячи двадцать шестого года');
    expect(sayRussianDate(nov12, { weekday: true, year: false }).everyday.text).toBe('четверг, двенадцатое ноября');
    expect(sayRussianDate(nov12, { weekday: false, year: true }).everyday.text).toBe('двенадцатое ноября две тысячи двадцать шестого года');
  });

  it('gives the "on" form, the day in the genitive and the weekday after в', () => {
    const on = sayRussianDate(nov12, all).also[0];
    expect(on.text).toBe('в четверг, двенадцатого ноября две тысячи двадцать шестого года');
    expect(on.note).toBe('Saying on which day');
    expect(sayRussianDate({ year: 2026, month: 11, day: 10 }, all).also[0].text).toMatch(/^во вторник, десятого ноября/);
    expect(sayRussianDate({ year: 2026, month: 11, day: 11 }, all).also[0].text).toMatch(/^в среду/);
  });

  it('writes it with digits', () => {
    expect(sayRussianDate(nov12, all).written.text).toBe('четверг, 12 ноября 2026 г.');
    expect(sayRussianDate(nov12, none).written.text).toBe('12 ноября');
  });

  it('romanizes every phrase', () => {
    const s = sayRussianDate(nov12, none);
    expect(s.everyday.roman).toBe('dvenadtsatoe noyabrya');
    expect(s.also[0].roman).toBe('dvenadtsatogo noyabrya');
    expect(s.written.roman).toBe('12 noyabrya');
  });

  it('refuses a day the month does not have', () => {
    expect(() => sayRussianDate({ year: 2026, month: 2, day: 30 }, none)).toThrow(RangeError);
  });
});

describe('Russian ordinals for dates', () => {
  it('says each day of the month', () => {
    expect([2, 4, 7, 8, 15, 20, 23, 31].map(dayOrdinal)).toEqual([
      'второе', 'четвёртое', 'седьмое', 'восьмое', 'пятнадцатое', 'двадцатое', 'двадцать третье', 'тридцать первое',
    ]);
    expect([1, 12, 20, 22, 31].map(dayOrdinalGenitive)).toEqual(['первого', 'двенадцатого', 'двадцатого', 'двадцать второго', 'тридцать первого']);
    expect(() => dayOrdinal(32)).toThrow(RangeError);
    expect(() => dayOrdinalGenitive(0)).toThrow(RangeError);
  });

  it('says a year with only its last part an ordinal', () => {
    expect(yearOrdinalGenitive(1950)).toBe('тысяча девятьсот пятидесятого');
    expect(yearOrdinalGenitive(1984)).toBe('тысяча девятьсот восемьдесят четвёртого');
    expect(yearOrdinalGenitive(1999)).toBe('тысяча девятьсот девяносто девятого');
    expect(yearOrdinalGenitive(2000)).toBe('двухтысячного');
    expect(yearOrdinalGenitive(2001)).toBe('две тысячи первого');
    expect(yearOrdinalGenitive(2010)).toBe('две тысячи десятого');
    expect(yearOrdinalGenitive(2040)).toBe('две тысячи сорокового');
    expect(yearOrdinalGenitive(1900)).toBe('тысяча девятисотого');
    expect(yearOrdinalGenitive(1000)).toBe('тысячного');
    expect(() => yearOrdinalGenitive(0)).toThrow(RangeError);
  });
});
