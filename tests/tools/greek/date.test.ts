import { describe, expect, it } from 'vitest';
import { sayGreekDate } from '../../../src/tools/greek/date';

const nov12 = { year: 2026, month: 11, day: 12 };
const all = { weekday: true, year: true };
const none = { weekday: false, year: false };

describe('a date in Greek', () => {
  it('says the day, the month in the genitive, the weekday and year when asked', () => {
    expect(sayGreekDate(nov12, all).everyday.text).toBe('Πέμπτη, δώδεκα Νοεμβρίου δύο χιλιάδες είκοσι έξι');
    expect(sayGreekDate(nov12, none).everyday.text).toBe('δώδεκα Νοεμβρίου');
    expect(sayGreekDate(nov12, { weekday: true, year: false }).everyday.text).toBe('Πέμπτη, δώδεκα Νοεμβρίου');
    expect(sayGreekDate(nov12, { weekday: false, year: true }).everyday.text).toBe('δώδεκα Νοεμβρίου δύο χιλιάδες είκοσι έξι');
  });

  it('says the first as πρώτη, and other days in the feminine', () => {
    expect(sayGreekDate({ year: 2026, month: 3, day: 1 }, none).everyday.text).toBe('πρώτη Μαρτίου');
    expect(sayGreekDate({ year: 2026, month: 3, day: 3 }, none).everyday.text).toBe('τρεις Μαρτίου');
    expect(sayGreekDate({ year: 2026, month: 5, day: 24 }, none).everyday.text).toBe('είκοσι τέσσερις Μαΐου');
    expect(sayGreekDate({ year: 2026, month: 5, day: 31 }, none).everyday.text).toBe('τριάντα μία Μαΐου');
  });

  it('says years as plain numbers', () => {
    expect(sayGreekDate({ year: 1950, month: 1, day: 2 }, { weekday: false, year: true }).everyday.text).toBe('δύο Ιανουαρίου χίλια εννιακόσια πενήντα');
    expect(sayGreekDate({ year: 1981, month: 1, day: 2 }, { weekday: false, year: true }).everyday.text).toBe('δύο Ιανουαρίου χίλια εννιακόσια ογδόντα ένα');
    expect(sayGreekDate({ year: 2000, month: 1, day: 2 }, { weekday: false, year: true }).everyday.text).toBe('δύο Ιανουαρίου δύο χιλιάδες');
  });

  it('gives the everyday month name and the form saying on which day', () => {
    expect(sayGreekDate(nov12, all).also.map((p) => p.text)).toEqual([
      'Πέμπτη, δώδεκα του Νοέμβρη δύο χιλιάδες είκοσι έξι',
      'Πέμπτη, στις δώδεκα Νοεμβρίου δύο χιλιάδες είκοσι έξι',
    ]);
    expect(sayGreekDate({ year: 2026, month: 1, day: 1 }, none).also.map((p) => p.text)).toEqual(['πρώτη του Γενάρη', 'την πρώτη Ιανουαρίου']);
  });

  it('romanizes every phrase', () => {
    const s = sayGreekDate(nov12, none);
    expect(s.everyday.roman).toBe('dódeka noemvríou');
    expect([...s.also, s.written].every((p) => !!p.roman)).toBe(true);
  });

  it('writes it with digits', () => {
    expect(sayGreekDate(nov12, all).written.text).toBe('Πέμπτη 12 Νοεμβρίου 2026');
    expect(sayGreekDate(nov12, none).written.text).toBe('12 Νοεμβρίου');
  });

  it('refuses a date that does not exist', () => {
    expect(() => sayGreekDate({ year: 2025, month: 2, day: 29 }, none)).toThrow(RangeError);
  });
});
