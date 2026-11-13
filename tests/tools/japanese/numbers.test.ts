import { describe, expect, it } from 'vitest';
import { enWord, funWord, gatsuWord, japaneseNumber, jiWord, nenWord, nichiWord } from '../../../src/tools/japanese/numbers';

describe('Japanese numbers', () => {
  it('says a number in kanji with its reading, 一 left off before 十, 百 and 千 but not 万', () => {
    expect([0, 10, 21, 100, 1000, 10000, 1277, 12345].map(japaneseNumber)).toEqual([
      ['零', 'れい'],
      ['十', 'じゅう'],
      ['二十一', 'にじゅういち'],
      ['百', 'ひゃく'],
      ['千', 'せん'],
      ['一万', 'いちまん'],
      ['千二百七十七', 'せんにひゃくななじゅうなな'],
      ['一万二千三百四十五', 'いちまんにせんさんびゃくよんじゅうご'],
    ]);
  });

  it('changes the sound of 百 and 千 after some digits', () => {
    expect([300, 600, 800, 3000, 8000].map((n) => japaneseNumber(n)[1])).toEqual([
      'さんびゃく', 'ろっぴゃく', 'はっぴゃく', 'さんぜん', 'はっせん',
    ]);
  });

  it('refuses a number out of range', () => {
    expect(() => japaneseNumber(-1)).toThrow(RangeError);
    expect(() => japaneseNumber(1.5)).toThrow(RangeError);
    expect(() => japaneseNumber(100_000_000)).toThrow(RangeError);
  });
});

describe('Japanese counters', () => {
  it('reads hours, with 4, 7 and 9 as よ, しち and く', () => {
    expect([4, 7, 9, 14, 19, 0].map((h) => jiWord(h)[1])).toEqual(['よじ', 'しちじ', 'くじ', 'じゅうよじ', 'じゅうくじ', 'れいじ']);
  });

  it('reads minutes with ぷん after 1, 3, 4, 6, 8 and the tens', () => {
    expect([1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 41].map((m) => funWord(m)[1])).toEqual([
      'いっぷん', 'にふん', 'さんぷん', 'よんぷん', 'ごふん', 'ろっぷん', 'はっぷん', 'じゅっぷん', 'じゅうごふん', 'にじゅっぷん', 'よんじゅういっぷん',
    ]);
  });

  it('reads yen, years and months', () => {
    expect(enWord(4)).toEqual(['四円', 'よえん']);
    expect(enWord(10000)).toEqual(['一万円', 'いちまんえん']);
    expect(nenWord(2024)).toEqual(['二千二十四年', 'にせんにじゅうよねん']);
    expect([4, 7, 9, 11].map((m) => gatsuWord(m)[1])).toEqual(['しがつ', 'しちがつ', 'くがつ', 'じゅういちがつ']);
  });

  it('reads the days of the month that have their own reading', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 14, 20, 24].map((d) => nichiWord(d)[1])).toEqual([
      'ついたち', 'ふつか', 'みっか', 'よっか', 'いつか', 'むいか', 'なのか', 'ようか', 'ここのか', 'とおか', 'じゅうよっか', 'はつか', 'にじゅうよっか',
    ]);
    expect([11, 17, 19, 31].map(nichiWord)).toEqual([
      ['十一日', 'じゅういちにち'], ['十七日', 'じゅうしちにち'], ['十九日', 'じゅうくにち'], ['三十一日', 'さんじゅういちにち'],
    ]);
  });
});
