import { describe, expect, it } from 'vitest';
import { sayTurkishDate } from '../../../src/tools/turkish/date';

const nov12 = { year: 2026, month: 11, day: 12 };
const all = { weekday: true, year: true };
const none = { weekday: false, year: false };

describe('a date in Turkish', () => {
  it('says the day as a plain number, then the month, then the year, and the weekday last', () => {
    expect(sayTurkishDate(nov12, all).everyday.text).toBe('on iki Kasım iki bin yirmi altı Perşembe');
    expect(sayTurkishDate(nov12, none).everyday.text).toBe('on iki Kasım');
    expect(sayTurkishDate(nov12, { weekday: true, year: false }).everyday.text).toBe('on iki Kasım Perşembe');
    expect(sayTurkishDate(nov12, { weekday: false, year: true }).everyday.text).toBe('on iki Kasım iki bin yirmi altı');
  });

  it('says years before 2000 in thousands and hundreds', () => {
    expect(sayTurkishDate({ year: 1987, month: 3, day: 21 }, { weekday: false, year: true }).everyday.text).toBe('yirmi bir Mart bin dokuz yüz seksen yedi');
  });

  it('writes the date with digits, the month and the weekday capitalized', () => {
    expect(sayTurkishDate(nov12, all).written.text).toBe('12 Kasım 2026 Perşembe');
    expect(sayTurkishDate(nov12, none).written.text).toBe('12 Kasım');
  });

  it('names every month and weekday', () => {
    const month = (m: number) => sayTurkishDate({ year: 2026, month: m, day: 1 }, none).everyday.text.split(' ')[1];
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(month)).toEqual([
      'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
    ]);
    // 15 November 2026 is a Sunday; the seven days after it run through the week.
    const day = (d: number) => sayTurkishDate({ year: 2026, month: 11, day: d }, { weekday: true, year: false }).everyday.text.split(' ').pop();
    expect([15, 16, 17, 18, 19, 20, 21].map(day)).toEqual(['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi']);
  });

  it('has no other ways to say it', () => {
    expect(sayTurkishDate(nov12, all).also).toEqual([]);
  });

  it('refuses a date that is not one', () => {
    expect(() => sayTurkishDate({ year: 2026, month: 2, day: 30 }, none)).toThrow(RangeError);
  });
});
