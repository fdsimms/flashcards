import { describe, expect, it } from 'vitest';
import { CURRENCIES } from '../../src/tools/money';
import { datePatterns, moneyPatterns, numberPatterns, timePatterns } from '../../src/tools/patterns';

describe('a time’s patterns', () => {
  it('gives Thai’s part of the day, so a miss at 19:55 leans toward every thûm hour', () => {
    expect(timePatterns({ hour: 19, minute: 55 }, 'th')).toEqual(['band:thum', 'minutes:to']);
    expect(timePatterns({ hour: 23, minute: 5 }, 'th')).toEqual(['band:thum', 'minutes:past']);
    expect([0, 3, 9, 12, 14, 16, 17, 18].map((hour) => timePatterns({ hour, minute: 0 }, 'th')[0]))
      .toEqual(['band:midnight', 'band:dtii', 'band:chao', 'band:noon', 'band:baai', 'band:baai', 'band:yen', 'band:yen']);
  });

  it('gives other languages the hour on the 12-hour clock', () => {
    expect(timePatterns({ hour: 19, minute: 30 }, 'de')).toEqual(['hour:7', 'minutes:30']);
    expect(timePatterns({ hour: 0, minute: 15 }, 'pl')).toEqual(['hour:12', 'minutes:15']);
    expect(timePatterns({ hour: 12, minute: 45 }, 'es')).toEqual(['hour:12', 'minutes:45']);
    expect(timePatterns({ hour: 7, minute: 0 }, 'ru')).toEqual(['hour:7', 'minutes:oclock']);
  });
});

describe('an amount’s patterns', () => {
  const PLN = CURRENCIES.PLN;

  it('gives how it ends, how its thousands end, and a minor part when it has one', () => {
    expect(moneyPatterns(2300, PLN)).toEqual(['ends:2-4']);
    expect(moneyPatterns(1_277_50, PLN)).toEqual(['ends:5-9', 'thousands:1', 'minor']);
    expect(moneyPatterns(5_000_00, PLN)).toEqual(['ends:0', 'thousands:5-9']);
    expect(moneyPatterns(100, PLN)).toEqual(['ends:1']);
  });

  it('leaves out what nearly every amount has, so a miss leans toward its own kind', () => {
    // A rouble amount is always whole, and most up to 10,000 have four digits: neither tells one apart.
    for (const a of [12, 313, 714, 5000, 9999]) expect(moneyPatterns(a * 100, CURRENCIES.RUB).filter((p) => p.startsWith('minor') || p.startsWith('digits'))).toEqual([]);
  });

  it('sets the teens apart from the endings they’d otherwise share', () => {
    // 22, 12, 112, 21, 20 and 25 zł.
    expect([2200, 1200, 11200, 2100, 2000, 2500].map((a) => moneyPatterns(a, PLN)[0])).toEqual(['ends:2-4', 'ends:teen', 'ends:teen', 'ends:1', 'ends:0', 'ends:5-9']);
  });
});

describe('a date’s patterns', () => {
  const d = { year: 2026, month: 11, day: 23 };

  it('gives the month and the day’s tens and ones', () => {
    expect(datePatterns(d, { weekday: false, year: false })).toEqual(['month:11', 'day-tens:2', 'day-ones:3']);
  });

  it('adds the weekday and the decade only when they’re said', () => {
    expect(datePatterns(d, { weekday: true, year: true })).toEqual(['month:11', 'day-tens:2', 'day-ones:3', 'weekday:1', 'decade:2020']);
  });
});

describe('a number’s patterns', () => {
  it('gives a plain number’s size and how it ends', () => {
    expect(numberPatterns({ kind: 'number', n: 7 })).toEqual(['number:digits:1', 'number:ends:5-9']);
    expect(numberPatterns({ kind: 'number', n: 482_312 })).toEqual(['number:digits:6', 'number:ends:teen']);
  });

  it('keeps each kind apart, so a Polish age ending in 2 to 4 leans only toward ages', () => {
    expect(numberPatterns({ kind: 'age', n: 34 })).toEqual(['age:tens:3', 'age:ends:2-4']);
    expect(numberPatterns({ kind: 'year', n: 1987 })).toEqual(['year:decade:1980', 'year:ends:5-9']);
  });

  it('gives a phone number none, since every one is made the same way', () => {
    expect(numberPatterns({ kind: 'phone', written: '06 42 17 85 93' })).toEqual([]);
  });
});
