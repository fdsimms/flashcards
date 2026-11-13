import { describe, expect, it } from 'vitest';
import { eraOf, sayJapaneseDate } from '../../../src/tools/japanese/date';

const all = { weekday: true, year: true };
const bare = { weekday: false, year: false };

describe('a date in Japanese', () => {
  it('says the year, month, day and weekday, largest first, with readings', () => {
    const s = sayJapaneseDate({ year: 2026, month: 11, day: 13 }, all);
    expect(s.everyday).toEqual({ text: '二千二十六年十一月十三日金曜日', roman: 'にせんにじゅうろくねん じゅういちがつ じゅうさんにち きんようび' });
    expect(s.written.text).toBe('2026年11月13日（金）');
  });

  it('reads the days with their own readings', () => {
    expect(sayJapaneseDate({ year: 2026, month: 4, day: 1 }, bare).everyday.roman).toBe('しがつ ついたち');
    expect(sayJapaneseDate({ year: 2026, month: 7, day: 20 }, bare).everyday.roman).toBe('しちがつ はつか');
    expect(sayJapaneseDate({ year: 2026, month: 7, day: 20 }, bare).written.text).toBe('7月20日');
  });

  it('offers the short weekday and the era year', () => {
    const also = sayJapaneseDate({ year: 2026, month: 11, day: 13 }, all).also;
    expect(also.map((p) => p.text)).toEqual(['二千二十六年十一月十三日金曜', '令和八年十一月十三日金曜日']);
    expect(also[1].note).toBe('The year of the era (令和)');
  });

  it('counts the eras from the day each began, its first year 元年', () => {
    expect(eraOf({ year: 2019, month: 4, day: 30 })).toMatchObject({ name: ['平成', 'へいせい'], year: 31 });
    expect(eraOf({ year: 2019, month: 5, day: 1 })).toMatchObject({ name: ['令和', 'れいわ'], year: 1 });
    expect(eraOf({ year: 1989, month: 1, day: 7 })).toMatchObject({ name: ['昭和', 'しょうわ'], year: 64 });
    expect(eraOf({ year: 1950, month: 6, day: 1 })).toMatchObject({ name: ['昭和', 'しょうわ'], year: 25 });
    const first = sayJapaneseDate({ year: 2019, month: 5, day: 1 }, { weekday: false, year: true });
    expect(first.also.map((p) => p.text)).toContain('令和元年五月一日');
  });

  it('refuses a date that is not one', () => {
    expect(() => sayJapaneseDate({ year: 2026, month: 2, day: 30 }, all)).toThrow(RangeError);
  });
});
