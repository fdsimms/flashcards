import { describe, expect, it } from 'vitest';
import { germanNumber } from '../../../src/tools/german/numbers';
import { sayGermanTime } from '../../../src/tools/german/time';

const everyday = (hour: number, minute = 0) => sayGermanTime({ hour, minute }).everyday.text;
const also = (hour: number, minute = 0) => sayGermanTime({ hour, minute }).also.map((p) => p.text);
const formal = (hour: number, minute = 0) => sayGermanTime({ hour, minute }).formal.text;

describe('German numbers', () => {
  it('says ones, teens, tens and the ones before the tens', () => {
    expect([0, 1, 7, 16, 17, 20, 21, 30, 37, 59].map(germanNumber)).toEqual([
      'null', 'eins', 'sieben', 'sechzehn', 'siebzehn', 'zwanzig', 'einundzwanzig', 'dreißig', 'siebenunddreißig', 'neunundfünfzig',
    ]);
  });

  it('refuses a number out of range', () => {
    expect(() => germanNumber(100)).toThrow(RangeError);
    expect(() => germanNumber(-1)).toThrow(RangeError);
  });
});

describe('a time in German', () => {
  it('says the hour with Uhr, ein Uhr for one, on a 12-hour clock', () => {
    expect(everyday(14)).toBe('zwei Uhr');
    expect(everyday(1)).toBe('ein Uhr');
    expect(everyday(13)).toBe('ein Uhr');
    expect(everyday(0)).toBe('zwölf Uhr');
    expect(everyday(12)).toBe('zwölf Uhr');
    expect(also(1)).toEqual(['ein Uhr nachts', 'eins']);
    expect(also(0)).toEqual(['zwölf Uhr nachts', 'zwölf', 'Mitternacht']);
    expect(also(12)).toEqual(['zwölf Uhr mittags', 'zwölf', 'Mittag']);
  });

  it('counts past the hour up to 20 past', () => {
    expect(everyday(14, 5)).toBe('fünf nach zwei');
    expect(everyday(14, 1)).toBe('eins nach zwei');
    expect(everyday(14, 10)).toBe('zehn nach zwei');
    expect(everyday(14, 17)).toBe('siebzehn nach zwei');
  });

  it('says quarter past and quarter to, with the regional forms', () => {
    expect(everyday(14, 15)).toBe('Viertel nach zwei');
    expect(also(14, 15)).toEqual(['Viertel nach zwei nachmittags', 'viertel drei']);
    expect(sayGermanTime({ hour: 14, minute: 15 }).also[1].note).toMatch(/southern Germany/);
    expect(everyday(14, 45)).toBe('Viertel vor drei');
    expect(also(14, 45)).toEqual(['Viertel vor drei nachmittags', 'dreiviertel drei']);
  });

  it('says 20 past and 20 to both ways', () => {
    expect(everyday(14, 20)).toBe('zwanzig nach zwei');
    expect(also(14, 20)).toContain('zehn vor halb drei');
    expect(everyday(14, 40)).toBe('zwanzig vor drei');
    expect(also(14, 40)).toContain('zehn nach halb drei');
  });

  it('counts around the half hour, which belongs to the next hour', () => {
    expect(everyday(14, 25)).toBe('fünf vor halb drei');
    expect(also(14, 25)).toContain('fünfundzwanzig nach zwei');
    expect(everyday(14, 30)).toBe('halb drei');
    expect(everyday(12, 30)).toBe('halb eins');
    expect(everyday(23, 30)).toBe('halb zwölf');
    expect(everyday(14, 35)).toBe('fünf nach halb drei');
  });

  it('counts to the next hour after 40', () => {
    expect(everyday(14, 50)).toBe('zehn vor drei');
    expect(everyday(11, 55)).toBe('fünf vor zwölf');
    expect(everyday(23, 59)).toBe('eins vor zwölf');
    expect(everyday(0, 50)).toBe('zehn vor eins');
  });

  it('adds the part of the day as another way to say it', () => {
    expect(also(3, 30)).toContain('halb vier nachts');
    expect(also(7, 30)).toContain('halb acht morgens');
    expect(also(10, 30)).toContain('halb elf vormittags');
    expect(also(13, 30)).toContain('halb zwei mittags');
    expect(also(19, 30)).toContain('halb acht abends');
    expect(also(23, 10)).toContain('zehn nach elf nachts');
  });

  it('gives the formal 24-hour form', () => {
    expect(formal(14, 30)).toBe('vierzehn Uhr dreißig');
    expect(formal(14)).toBe('vierzehn Uhr');
    expect(formal(0)).toBe('null Uhr');
    expect(formal(1, 5)).toBe('ein Uhr fünf');
    expect(formal(21, 1)).toBe('einundzwanzig Uhr eins');
  });

  it('refuses what is not a time of day', () => {
    expect(() => sayGermanTime({ hour: 24, minute: 0 })).toThrow(RangeError);
    expect(() => sayGermanTime({ hour: 3, minute: 60 })).toThrow(RangeError);
  });
});
