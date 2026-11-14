import { describe, expect, it } from 'vitest';
import { JAPANESE_COUNTING as ja } from '../../../src/tools/japanese/counting';

const find = (meaning: string) => ja.nouns.findIndex((n) => n.meaning === meaning);
const reading = (meaning: string, n: number) => ja.say(find(meaning), n).everyday.roman;

describe('counting things in Japanese', () => {
  it('says the noun, が, and the number with its counter, its sound changed where it changes', () => {
    expect(ja.say(find('pencil'), 3).everyday).toEqual({ text: '鉛筆が三本', roman: 'えんぴつがさんぼん' });
    expect([1, 3, 6, 8, 10, 4].map((n) => reading('pencil', n))).toEqual(['えんぴつがいっぽん', 'えんぴつがさんぼん', 'えんぴつがろっぽん', 'えんぴつがはっぽん', 'えんぴつがじゅっぽん', 'えんぴつがよんほん']);
    expect([1, 3].map((n) => reading('cat', n))).toEqual(['ねこがいっぴき', 'ねこがさんびき']);
    expect([1, 3, 8].map((n) => reading('book', n))).toEqual(['ほんがいっさつ', 'ほんがさんさつ', 'ほんがはっさつ']);
    expect(ja.say(find('pencil'), 3).also[0]).toEqual({ text: '三本の鉛筆', roman: 'さんぼんのえんぴつ' });
  });

  it('doubles the sound of 百 before a p: ひゃっぽん, ひゃっぴき, ひゃっぱい', () => {
    expect([100, 101].map((n) => reading('pencil', n))).toEqual(['えんぴつがひゃっぽん', 'えんぴつがひゃくいっぽん']);
    expect(ja.say(find('cat'), 100).everyday.text).toBe('猫が百匹');
    expect(reading('cat', 100)).toBe('ねこがひゃっぴき');
    expect(reading('coffee', 100)).toBe('コーヒーがひゃっぱい');
    expect(reading('book', 100)).toBe('ほんがひゃくさつ');
    expect(ja.wrong(find('pencil'), 100).map((p) => p.roman)).toContain('えんぴつがひゃくほん');
  });

  it('counts people ひとり and ふたり, then さんにん, with 4 as よにん', () => {
    expect([1, 2, 3, 4, 11, 14].map((n) => reading('student', n)))
      .toEqual(['がくせいがひとり', 'がくせいがふたり', 'がくせいがさんにん', 'がくせいがよにん', 'がくせいがじゅういちにん', 'がくせいがじゅうよにん']);
  });

  it('offers the counter read without its sound change among the wrong choices, and shows choices by reading', () => {
    expect(ja.wrong(find('pencil'), 3).map((p) => p.roman)).toContain('えんぴつがさんほん');
    expect(ja.pickByReading).toBe(true);
  });
});
