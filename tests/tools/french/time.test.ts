import { describe, expect, it } from 'vitest';
import { frenchNumber } from '../../../src/tools/french/numbers';
import { sayFrenchTime } from '../../../src/tools/french/time';

const everyday = (hour: number, minute = 0) => sayFrenchTime({ hour, minute }).everyday.text;
const also = (hour: number, minute = 0) => sayFrenchTime({ hour, minute }).also.map((p) => p.text);
const formal = (hour: number, minute = 0) => sayFrenchTime({ hour, minute }).formal.text;

describe('French numbers', () => {
  it('says them, with une for something feminine', () => {
    expect([0, 1, 17, 20, 21, 22, 31, 45, 59].map((n) => frenchNumber(n))).toEqual([
      'zéro', 'un', 'dix-sept', 'vingt', 'vingt et un', 'vingt-deux', 'trente et un', 'quarante-cinq', 'cinquante-neuf',
    ]);
    expect([1, 21, 51].map((n) => frenchNumber(n, true))).toEqual(['une', 'vingt et une', 'cinquante et une']);
    expect(() => frenchNumber(-1)).toThrow(RangeError);
  });
});

describe('a time in French', () => {
  it('says each hour on the 12-hour clock, with midi and minuit', () => {
    expect([0, 1, 2, 11, 12, 13, 14, 23].map((h) => everyday(h))).toEqual([
      'minuit', 'une heure', 'deux heures', 'onze heures', 'midi', 'une heure', 'deux heures', 'onze heures',
    ]);
  });

  it('says et quart, et demie and the minutes up to :39', () => {
    expect(everyday(2, 15)).toBe('deux heures et quart');
    expect(everyday(14, 30)).toBe('deux heures et demie');
    expect(everyday(12, 30)).toBe('midi et demi');
    expect(everyday(0, 30)).toBe('minuit et demi');
    expect(everyday(0, 15)).toBe('minuit et quart');
    expect(everyday(9, 5)).toBe('neuf heures cinq');
    expect(everyday(9, 21)).toBe('neuf heures vingt et une');
  });

  it('says the next hour moins the minutes left from :40', () => {
    expect(everyday(2, 45)).toBe('trois heures moins le quart');
    expect(everyday(2, 50)).toBe('trois heures moins dix');
    expect(everyday(11, 45)).toBe('midi moins le quart');
    expect(everyday(23, 40)).toBe('minuit moins vingt');
    expect(everyday(12, 55)).toBe('une heure moins cinq');
    expect(everyday(8, 59)).toBe('neuf heures moins une');
  });

  it('gives the part of the day, never after midi or minuit, and other ways to say it', () => {
    expect(also(7)).toEqual(['sept heures du matin']);
    expect(also(15, 30)).toEqual(["trois heures et demie de l'après-midi"]);
    expect(also(20, 10)).toEqual(['huit heures dix du soir']);
    expect(also(12)).toEqual([]);
    expect(also(0, 15)).toEqual([]);
    expect(also(14, 35)).toEqual(["deux heures trente-cinq de l'après-midi", 'trois heures moins vingt-cinq']);
    expect(also(14, 45)).toEqual(["trois heures moins le quart de l'après-midi", 'deux heures quarante-cinq']);
    expect(also(11, 45)).toEqual(['onze heures quarante-cinq']);
    // By the hour that's named: six heures, so du soir.
    expect(also(17, 40)).toEqual(['six heures moins vingt du soir', 'cinq heures quarante']);
  });

  it('gives the formal 24-hour form', () => {
    expect(formal(14, 30)).toBe('quatorze heures trente');
    expect(formal(14)).toBe('quatorze heures');
    expect(formal(0)).toBe('zéro heure');
    expect(formal(0, 30)).toBe('zéro heure trente');
    expect(formal(1)).toBe('une heure');
    expect(formal(21, 21)).toBe('vingt et une heures vingt et une');
  });

  it('refuses what is not a time of day', () => {
    expect(() => sayFrenchTime({ hour: 24, minute: 0 })).toThrow(RangeError);
    expect(() => sayFrenchTime({ hour: 3, minute: 60 })).toThrow(RangeError);
  });
});
