import { describe, expect, it } from 'vitest';
import { hourOrdinal, hourOrdinalOblique, polishNumber } from '../../../src/tools/polish/numbers';
import { sayPolishTime } from '../../../src/tools/polish/time';

const say = (hour: number, minute = 0) => sayPolishTime({ hour, minute });
const everyday = (hour: number, minute = 0) => say(hour, minute).everyday.text;
const also = (hour: number, minute = 0) => say(hour, minute).also.map((p) => p.text);

describe('Polish numbers', () => {
  it('says them, feminine where asked', () => {
    expect([0, 1, 2, 12, 20, 21, 22, 45].map((n) => polishNumber(n))).toEqual(['zero', 'jeden', 'dwa', 'dwanaście', 'dwadzieścia', 'dwadzieścia jeden', 'dwadzieścia dwa', 'czterdzieści pięć']);
    expect([1, 2, 21, 22].map((n) => polishNumber(n, true))).toEqual(['jedna', 'dwie', 'dwadzieścia jeden', 'dwadzieścia dwie']);
    expect(() => polishNumber(60)).toThrow(RangeError);
  });

  it('says the hours as feminine ordinals, in the nominative and after po', () => {
    expect([1, 2, 3, 12, 20, 21, 24].map(hourOrdinal)).toEqual(['pierwsza', 'druga', 'trzecia', 'dwunasta', 'dwudziesta', 'dwudziesta pierwsza', 'dwudziesta czwarta']);
    expect([1, 2, 3, 12, 23].map(hourOrdinalOblique)).toEqual(['pierwszej', 'drugiej', 'trzeciej', 'dwunastej', 'dwudziestej trzeciej']);
    expect(() => hourOrdinal(0)).toThrow(RangeError);
    expect(() => hourOrdinalOblique(25)).toThrow(RangeError);
  });
});

describe('a time in Polish', () => {
  it('says each hour on the hour', () => {
    expect([...Array(13).keys()].map((h) => everyday(h))).toEqual([
      'dwunasta', 'pierwsza', 'druga', 'trzecia', 'czwarta', 'piąta', 'szósta',
      'siódma', 'ósma', 'dziewiąta', 'dziesiąta', 'jedenasta', 'dwunasta',
    ]);
    expect(everyday(14)).toBe('druga');
  });

  it('says minutes past with po and half past toward the next hour', () => {
    expect(everyday(14, 1)).toBe('minuta po drugiej');
    expect(everyday(14, 2)).toBe('dwie po drugiej');
    expect(everyday(14, 10)).toBe('dziesięć po drugiej');
    expect(everyday(14, 22)).toBe('dwadzieścia dwie po drugiej');
    expect(everyday(14, 15)).toBe('kwadrans po drugiej');
    expect(everyday(14, 30)).toBe('wpół do trzeciej');
    expect(everyday(12, 30)).toBe('wpół do pierwszej');
  });

  it('says the minutes left after half past with za', () => {
    expect(everyday(14, 45)).toBe('za kwadrans trzecia');
    expect(everyday(14, 50)).toBe('za dziesięć trzecia');
    expect(everyday(14, 58)).toBe('za dwie trzecia');
    expect(everyday(14, 59)).toBe('za minutę trzecia');
    expect(everyday(12, 50)).toBe('za dziesięć pierwsza');
  });

  it('reads the clock as it shows just past half past, and still takes za', () => {
    expect(everyday(13, 31)).toBe('pierwsza trzydzieści jeden');
    expect(everyday(14, 34)).toBe('druga trzydzieści cztery');
    expect(also(13, 31)).toContain('za dwadzieścia dziewięć druga');
    expect(everyday(14, 35)).toBe('za dwadzieścia pięć trzecia');
  });

  it('gives the part of the day', () => {
    expect(also(2)[0]).toBe('druga w nocy');
    expect(also(23)[0]).toBe('jedenasta w nocy');
    expect(also(6)[0]).toBe('szósta rano');
    expect(also(10)[0]).toBe('dziesiąta przed południem');
    expect(also(12)[0]).toBe('dwunasta w południe');
    expect(also(12, 30)[0]).toBe('wpół do pierwszej po południu');
    expect(also(17)[0]).toBe('piąta po południu');
    expect(also(18)[0]).toBe('szósta wieczorem');
  });

  it('gives the other ways to say it', () => {
    expect(also(12)).toEqual(['dwunasta w południe', 'południe', 'dwunasta zero zero']);
    expect(also(0)).toEqual(['dwunasta w nocy', 'północ']);
    expect(also(14, 15)).toContain('piętnaście po drugiej');
    expect(also(14, 45)).toContain('za piętnaście trzecia');
    expect(also(14, 25)).toContain('za pięć wpół do trzeciej');
    expect(also(14, 20)).toContain('za dziesięć wpół do trzeciej');
    expect(also(14, 35)).toContain('pięć po wpół do trzeciej');
    expect(also(14, 40)).toContain('dziesięć po wpół do trzeciej');
    expect(also(14, 5)).toEqual(['pięć po drugiej po południu', 'druga zero pięć']);
    expect(say(14, 25).also.find((p) => p.text === 'za pięć wpół do trzeciej')?.note).toBe('Counted from half past');
    expect(say(14, 5).also.find((p) => p.text === 'druga zero pięć')?.note).toBe('As read off a digital clock');
    expect(say(14, 30).also.every((p) => p.roman === undefined)).toBe(true);
  });

  it('gives the formal 24-hour form', () => {
    expect(say(14, 30).formal.text).toBe('czternasta trzydzieści');
    expect(say(14, 2).formal.text).toBe('czternasta zero dwa');
    expect(say(14, 22).formal.text).toBe('czternasta dwadzieścia dwie');
    expect(say(14).formal.text).toBe('czternasta');
    expect(say(21).formal.text).toBe('dwudziesta pierwsza');
    expect(say(0).formal.text).toBe('dwudziesta czwarta');
    expect(say(0, 15).formal.text).toBe('zero piętnaście');
  });

  it('refuses what is not a time of day', () => {
    expect(() => say(24, 0)).toThrow(RangeError);
    expect(() => say(3, 60)).toThrow(RangeError);
    expect(() => say(-1, 0)).toThrow(RangeError);
  });
});
