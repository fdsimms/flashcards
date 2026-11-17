import { describe, expect, it } from 'vitest';
import { sayTurkishTime } from '../../../src/tools/turkish/time';

const everyday = (hour: number, minute = 0) => sayTurkishTime({ hour, minute }).everyday.text;
const also = (hour: number, minute = 0) => sayTurkishTime({ hour, minute }).also.map((p) => p.text);
const formal = (hour: number, minute = 0) => sayTurkishTime({ hour, minute }).formal.text;

describe('a time in Turkish', () => {
  it('says saat and the hour on a 12-hour clock', () => {
    expect(everyday(15)).toBe('saat üç');
    expect(everyday(3)).toBe('saat üç');
    expect(everyday(1)).toBe('saat bir');
    expect(everyday(12)).toBe('saat on iki');
    expect(everyday(0)).toBe('saat on iki');
  });

  it('says half past as buçuk', () => {
    expect(everyday(15, 30)).toBe('saat üç buçuk');
    expect(everyday(12, 30)).toBe('saat on iki buçuk');
  });

  it('counts the minutes past the hour with the hour in the accusative and geçiyor', () => {
    expect(everyday(15, 5)).toBe('saat üçü beş geçiyor');
    expect(everyday(15, 15)).toBe('saat üçü çeyrek geçiyor');
    expect(everyday(15, 25)).toBe('saat üçü yirmi beş geçiyor');
    expect(everyday(0, 5)).toBe('saat on ikiyi beş geçiyor');
  });

  it('counts the minutes to the next hour with that hour in the dative and var', () => {
    expect(everyday(15, 35)).toBe('saat dörde yirmi beş var');
    expect(everyday(15, 45)).toBe('saat dörde çeyrek var');
    expect(everyday(15, 55)).toBe('saat dörde beş var');
    expect(everyday(23, 50)).toBe('saat on ikiye on var');
    expect(everyday(12, 50)).toBe('saat bire on var');
  });

  it('gives each hour the endings its sound takes', () => {
    const acc = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((h) => everyday(h, 5).replace(/^saat | beş geçiyor$/g, ''));
    expect(acc).toEqual(['biri', 'ikiyi', 'üçü', 'dördü', 'beşi', 'altıyı', 'yediyi', 'sekizi', 'dokuzu', 'onu', 'on biri', 'on ikiyi']);
    const dat = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((h) => everyday(h - 1 || 12, 50).replace(/^saat | on var$/g, ''));
    expect(dat).toEqual(['bire', 'ikiye', 'üçe', 'dörde', 'beşe', 'altıya', 'yediye', 'sekize', 'dokuza', 'ona', 'on bire', 'on ikiye']);
  });

  it('gives the part of the day before it, and the time without saat and read as numbers', () => {
    expect(also(15, 5)).toEqual(['öğleden sonra saat üçü beş geçiyor', 'üçü beş geçiyor', 'saat üç beş']);
    expect(also(9, 30)).toEqual(['sabah saat dokuz buçuk', 'dokuz buçuk', 'saat dokuz otuz']);
    expect(also(15)).toEqual(['öğleden sonra saat üç', 'üç']);
  });

  it('puts each hour in its part of the day', () => {
    const part = (h: number) => also(h, 30)[0].split(' saat ')[0];
    expect([0, 4, 5, 11, 12, 13, 17, 18, 21, 22, 23].map(part)).toEqual([
      'gece', 'gece', 'sabah', 'sabah', 'öğlen', 'öğleden sonra', 'öğleden sonra', 'akşam', 'akşam', 'gece', 'gece',
    ]);
  });

  it('has noon and midnight as words of their own', () => {
    expect(also(12)).toEqual(['öğlen saat on iki', 'on iki', 'öğlen']);
    expect(also(0)).toEqual(['gece saat on iki', 'on iki', 'gece yarısı']);
  });

  it('reads the formal 24-hour time as numbers, with sıfır before a minute under ten', () => {
    expect(formal(15, 30)).toBe('saat on beş otuz');
    expect(formal(15, 5)).toBe('saat on beş sıfır beş');
    expect(formal(15)).toBe('saat on beş');
    expect(formal(0)).toBe('saat sıfır sıfır');
    expect(formal(0, 15)).toBe('saat sıfır on beş');
  });

  it('refuses a time that is not one', () => {
    expect(() => sayTurkishTime({ hour: 24, minute: 0 })).toThrow(RangeError);
    expect(() => sayTurkishTime({ hour: 3, minute: 60 })).toThrow(RangeError);
    expect(() => sayTurkishTime({ hour: 3.5, minute: 0 })).toThrow(RangeError);
  });
});
