import { describe, expect, it } from 'vitest';
import { CURRENCIES } from '../../src/tools/money';
import { datePatterns, moneyPatterns, timePatterns } from '../../src/tools/patterns';

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

  it('gives its size, whether it has a minor part, and how it ends', () => {
    expect(moneyPatterns(2300, PLN)).toEqual(['digits:2', 'minor:false', 'ends:2-4']);
    expect(moneyPatterns(1_277_50, PLN)).toEqual(['digits:4', 'minor:true', 'ends:5-9']);
    expect(moneyPatterns(100, PLN)).toEqual(['digits:1', 'minor:false', 'ends:1']);
  });

  it('sets the teens apart from the endings they’d otherwise share', () => {
    // 22, 12, 112, 21, 20 and 25 zł.
    expect([2200, 1200, 11200, 2100, 2000, 2500].map((a) => moneyPatterns(a, PLN)[2])).toEqual(['ends:2-4', 'ends:teen', 'ends:teen', 'ends:1', 'ends:0', 'ends:5-9']);
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
