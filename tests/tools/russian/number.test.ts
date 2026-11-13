import { describe, expect, it } from 'vitest';
import { sayRussianNumber } from '../../../src/tools/russian/number';
import { yearOrdinal } from '../../../src/tools/russian/numbers';

describe('a number in Russian', () => {
  it('reads a phone number in its groups, a leading 0 as ноль', () => {
    const s = sayRussianNumber({ kind: 'phone', written: '8 912 345-07-89' });
    expect(s.everyday.text).toBe('восемь, девятьсот двенадцать, триста сорок пять, ноль семь, восемьдесят девять');
    expect(s.also[0].text).toBe('восемь, девять один два, три четыре пять, ноль семь, восемь девять');
    expect(s.everyday.roman).toBeTruthy();
  });

  it('says a year as an ordinal, and in a year after в', () => {
    expect([1987, 2000, 2026, 1900, 2003].map((y) => yearOrdinal(y, 'nominative')))
      .toEqual(['тысяча девятьсот восемьдесят седьмой', 'двухтысячный', 'две тысячи двадцать шестой', 'тысяча девятисотый', 'две тысячи третий']);
    expect([1987, 2000, 2003, 2040].map((y) => yearOrdinal(y, 'prepositional')))
      .toEqual(['тысяча девятьсот восемьдесят седьмом', 'двухтысячном', 'две тысячи третьем', 'две тысячи сороковом']);
    expect(sayRussianNumber({ kind: 'year', n: 1987 }).also.map((p) => p.text)).toEqual(['в тысяча девятьсот восемьдесят седьмом году']);
  });

  it('says an age with мне, and год, года or лет', () => {
    expect([21, 22, 25, 11, 14, 34].map((n) => sayRussianNumber({ kind: 'age', n }).everyday.text))
      .toEqual(['мне двадцать один год', 'мне двадцать два года', 'мне двадцать пять лет', 'мне одиннадцать лет', 'мне четырнадцать лет', 'мне тридцать четыре года']);
  });
});
