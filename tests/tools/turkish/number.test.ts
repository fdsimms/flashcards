import { describe, expect, it } from 'vitest';
import { sayTurkishNumber } from '../../../src/tools/turkish/number';

describe('a number in Turkish', () => {
  it('says a plain number as separate words', () => {
    expect(sayTurkishNumber({ kind: 'number', n: 1277 }).everyday.text).toBe('bin iki yüz yetmiş yedi');
    expect(sayTurkishNumber({ kind: 'number', n: 100 }).also).toEqual([]);
  });

  it('reads a phone number digit by digit, a pause between its groups', () => {
    expect(sayTurkishNumber({ kind: 'phone', written: '0532 123 45 67' }).everyday.text).toBe('sıfır beş üç iki, bir iki üç, dört beş, altı yedi');
  });

  it('says a year as a plain number, not an ordinal', () => {
    expect(sayTurkishNumber({ kind: 'year', n: 1987 }).everyday.text).toBe('bin dokuz yüz seksen yedi');
    expect(sayTurkishNumber({ kind: 'year', n: 2026 }).everyday.text).toBe('iki bin yirmi altı');
  });

  it('says an age as the number and yaşındayım, with ben as well', () => {
    const age = sayTurkishNumber({ kind: 'age', n: 22 });
    expect(age.everyday.text).toBe('yirmi iki yaşındayım');
    expect(age.also.map((p) => p.text)).toEqual(['ben yirmi iki yaşındayım']);
  });
});
