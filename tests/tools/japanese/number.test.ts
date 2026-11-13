import { describe, expect, it } from 'vitest';
import { sayJapaneseNumber } from '../../../src/tools/japanese/number';
import { saiWord } from '../../../src/tools/japanese/numbers';

describe('a number in Japanese', () => {
  it('says a number grouped by 万, and a year with 年', () => {
    expect(sayJapaneseNumber({ kind: 'number', n: 482_315 }).everyday).toEqual({ text: '四十八万二千三百十五', roman: 'よんじゅうはちまんにせんさんびゃくじゅうご' });
    expect(sayJapaneseNumber({ kind: 'year', n: 1987 }).everyday).toEqual({ text: '千九百八十七年', roman: 'せんきゅうひゃくはちじゅうななねん' });
  });

  it('reads a phone number digit by digit in kana, 0 as ゼロ and each dash as の', () => {
    expect(sayJapaneseNumber({ kind: 'phone', written: '090-1234-5678' }).everyday).toEqual({ text: 'ゼロきゅうゼロの いちにさんよんの ごろくななはち' });
  });

  it('says an age with 歳, its sound changed after 1, 8 and 10, and 20 as はたち', () => {
    expect([1, 3, 8, 10, 11, 18, 30, 34].map((n) => saiWord(n)[1]))
      .toEqual(['いっさい', 'さんさい', 'はっさい', 'じゅっさい', 'じゅういっさい', 'じゅうはっさい', 'さんじゅっさい', 'さんじゅうよんさい']);
    expect(sayJapaneseNumber({ kind: 'age', n: 34 }).everyday).toEqual({ text: '三十四歳です', roman: 'さんじゅうよんさいです' });
    const twenty = sayJapaneseNumber({ kind: 'age', n: 20 });
    expect(twenty.everyday).toEqual({ text: '二十歳です', roman: 'はたちです' });
    expect(twenty.also).toEqual([{ text: '二十歳です', roman: 'にじゅっさいです', note: 'Heard too' }]);
  });
});
