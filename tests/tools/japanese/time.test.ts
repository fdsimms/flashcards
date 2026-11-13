import { describe, expect, it } from 'vitest';
import { sayJapaneseTime } from '../../../src/tools/japanese/time';

const say = (hour: number, minute = 0) => sayJapaneseTime({ hour, minute });

describe('a time in Japanese', () => {
  it('says it on a 12-hour clock in conversation, with its reading', () => {
    expect(say(15, 15).everyday).toEqual({ text: '三時十五分', roman: 'さんじ じゅうごふん' });
    expect(say(4).everyday).toEqual({ text: '四時', roman: 'よじ' });
    expect(say(0).everyday.text).toBe('十二時');
    expect(say(12, 10).everyday.text).toBe('十二時十分');
  });

  it('says half past with 半, and the minutes too', () => {
    expect(say(9, 30).everyday).toEqual({ text: '九時半', roman: 'くじ はん' });
    expect(say(9, 30).also.map((p) => p.text)).toContain('九時三十分');
  });

  it('offers 午前 or 午後, exactly on the hour, and before the hour', () => {
    expect(say(15, 15).also[0]).toEqual({ text: '午後三時十五分', roman: 'ごご さんじ じゅうごふん', note: 'With 午後, p.m.' });
    expect(say(8).also.map((p) => p.text)).toEqual(['午前八時', '八時ちょうど']);
    expect(say(14, 55).also.map((p) => p.text)).toContain('三時五分前');
    expect(say(12).also.map((p) => p.text)).toContain('正午');
  });

  it('gives the 24-hour form for timetables', () => {
    expect(say(15, 15).formal).toEqual({ text: '十五時十五分', roman: 'じゅうごじ じゅうごふん' });
    expect(say(0, 5).formal.text).toBe('零時五分');
    expect(say(19).formal.roman).toBe('じゅうくじ');
  });

  it('refuses a time that is not one', () => {
    expect(() => say(24)).toThrow(RangeError);
  });
});
