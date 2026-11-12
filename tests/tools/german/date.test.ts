import { describe, expect, it } from 'vitest';
import { sayGermanDate } from '../../../src/tools/german/date';
import { germanOrdinalStem, germanYear } from '../../../src/tools/german/numbers';

const nov12 = { year: 2026, month: 11, day: 12 };
const all = { weekday: true, year: true };
const none = { weekday: false, year: false };

describe('a date in German', () => {
  it('says the ordinal after der, with the weekday and year when asked', () => {
    expect(sayGermanDate(nov12, all).everyday.text).toBe('Donnerstag, der zwölfte November zweitausendsechsundzwanzig');
    expect(sayGermanDate(nov12, none).everyday.text).toBe('der zwölfte November');
    expect(sayGermanDate(nov12, { weekday: true, year: false }).everyday.text).toBe('Donnerstag, der zwölfte November');
    expect(sayGermanDate(nov12, { weekday: false, year: true }).everyday.text).toBe('der zwölfte November zweitausendsechsundzwanzig');
  });

  it('forms the irregular ordinals', () => {
    expect([1, 2, 3, 7, 8, 11, 16, 17, 19, 20, 21, 30, 31].map(germanOrdinalStem)).toEqual([
      'erst', 'zweit', 'dritt', 'siebt', 'acht', 'elft', 'sechzehnt', 'siebzehnt', 'neunzehnt', 'zwanzigst', 'einundzwanzigst', 'dreißigst', 'einunddreißigst',
    ]);
    expect(sayGermanDate({ year: 2026, month: 3, day: 1 }, none).everyday.text).toBe('der erste März');
    expect(sayGermanDate({ year: 2026, month: 7, day: 7 }, none).everyday.text).toBe('der siebte Juli');
  });

  it('says years before 2000 in hundreds', () => {
    expect(germanYear(1950)).toBe('neunzehnhundertfünfzig');
    expect(germanYear(1999)).toBe('neunzehnhundertneunundneunzig');
    expect(germanYear(1900)).toBe('neunzehnhundert');
    expect(germanYear(2000)).toBe('zweitausend');
    expect(germanYear(2001)).toBe('zweitausendeins');
    expect(germanYear(2049)).toBe('zweitausendneunundvierzig');
  });

  it('gives the form with am, and the month as a number', () => {
    expect(sayGermanDate(nov12, all).also.map((p) => p.text)).toEqual([
      'am Donnerstag, dem zwölften November zweitausendsechsundzwanzig',
      'Donnerstag, der zwölfte elfte zweitausendsechsundzwanzig',
    ]);
    expect(sayGermanDate(nov12, none).also.map((p) => p.text)).toEqual(['am zwölften November', 'der zwölfte elfte']);
    expect(sayGermanDate(nov12, none).also[0].note).toBeTruthy();
  });

  it('writes the day with a dot', () => {
    expect(sayGermanDate(nov12, all).written.text).toBe('Donnerstag, 12. November 2026');
    expect(sayGermanDate(nov12, none).written.text).toBe('12. November');
  });

  it('refuses a date that does not exist', () => {
    expect(() => sayGermanDate({ year: 2026, month: 2, day: 30 }, none)).toThrow(RangeError);
  });
});
