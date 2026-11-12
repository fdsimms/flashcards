import { describe, expect, it } from 'vitest';
import { spanishNumber } from '../../../src/tools/spanish/numbers';
import { saySpanishTime } from '../../../src/tools/spanish/time';

const everyday = (hour: number, minute = 0) => saySpanishTime({ hour, minute }).everyday.text;
const also = (hour: number, minute = 0) => saySpanishTime({ hour, minute }).also.map((p) => p.text);
const formal = (hour: number, minute = 0) => saySpanishTime({ hour, minute }).formal.text;

describe('Spanish numbers', () => {
  it('says them, with una for something feminine', () => {
    expect([0, 1, 16, 21, 22, 30, 31, 45, 59].map((n) => spanishNumber(n))).toEqual([
      'cero', 'uno', 'dieciséis', 'veintiuno', 'veintidós', 'treinta', 'treinta y uno', 'cuarenta y cinco', 'cincuenta y nueve',
    ]);
    expect([1, 21, 31].map((n) => spanishNumber(n, true))).toEqual(['una', 'veintiuna', 'treinta y una']);
    expect(() => spanishNumber(60)).toThrow(RangeError);
  });
});

describe('a time in Spanish', () => {
  it('says each hour on the 12-hour clock, la una and las otherwise', () => {
    expect([0, 1, 2, 12, 13, 14, 23].map((h) => everyday(h))).toEqual([
      'las doce', 'la una', 'las dos', 'las doce', 'la una', 'las dos', 'las once',
    ]);
  });

  it('says y cuarto, y media and y with the minutes up to :39', () => {
    expect(everyday(1, 15)).toBe('la una y cuarto');
    expect(everyday(14, 30)).toBe('las dos y media');
    expect(everyday(9, 5)).toBe('las nueve y cinco');
    expect(everyday(9, 21)).toBe('las nueve y veintiuno');
    expect(everyday(9, 39)).toBe('las nueve y treinta y nueve');
  });

  it('says the minutes left para the next hour from :40', () => {
    expect(everyday(2, 45)).toBe('cuarto para las tres');
    expect(everyday(2, 50)).toBe('diez para las tres');
    expect(everyday(12, 40)).toBe('veinte para la una');
    expect(everyday(0, 45)).toBe('cuarto para la una');
    expect(everyday(23, 55)).toBe('cinco para las doce');
    expect(everyday(10, 59)).toBe('un minuto para las once');
    expect(also(10, 59)).toContain('las once menos un minuto');
  });

  it('gives the part of the day and other ways to say it', () => {
    expect(also(3)).toEqual(['las tres de la madrugada', 'las tres en punto']);
    expect(also(12)).toEqual(['las doce del día', 'las doce en punto', 'mediodía']);
    expect(also(0)).toEqual(['las doce de la noche', 'las doce en punto', 'medianoche']);
    expect(also(9, 30)).toEqual(['las nueve y media de la mañana']);
    expect(also(19, 15)).toEqual(['las siete y cuarto de la tarde']);
    expect(also(21, 10)).toEqual(['las nueve y diez de la noche']);
    expect(also(14, 35)).toEqual(['las dos y treinta y cinco de la tarde', 'veinticinco para las tres', 'las tres menos veinticinco']);
    expect(also(14, 45)).toEqual(['cuarto para las tres de la tarde', 'las dos y cuarenta y cinco', 'las tres menos cuarto']);
    expect(also(0, 50)).toEqual(['diez para la una de la noche', 'las doce y cincuenta', 'la una menos diez']);
    expect(saySpanishTime({ hour: 2, minute: 50 }).also[2].note).toBe('In Spain');
    expect(saySpanishTime({ hour: 2, minute: 35 }).also[2].note).toBe('In Spain');
  });

  it('gives the formal 24-hour form', () => {
    expect(formal(14, 30)).toBe('las catorce treinta');
    expect(formal(14)).toBe('las catorce horas');
    expect(formal(21)).toBe('las veintiuna horas');
    expect(formal(21, 5)).toBe('las veintiuna cero cinco');
    expect(formal(0)).toBe('las cero horas');
    expect(formal(1)).toBe('la una');
    expect(formal(1, 45)).toBe('la una cuarenta y cinco');
  });

  it('has no romanization', () => {
    expect(saySpanishTime({ hour: 14, minute: 30 }).everyday.roman).toBeUndefined();
  });

  it('refuses what is not a time of day', () => {
    expect(() => saySpanishTime({ hour: 24, minute: 0 })).toThrow(RangeError);
    expect(() => saySpanishTime({ hour: 3, minute: 60 })).toThrow(RangeError);
  });
});
