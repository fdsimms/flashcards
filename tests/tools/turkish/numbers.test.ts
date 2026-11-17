import { describe, expect, it } from 'vitest';
import { turkishCardinal, turkishNumber } from '../../../src/tools/turkish/numbers';

describe('Turkish numbers', () => {
  it('says ones, teens and tens as separate words', () => {
    expect([0, 1, 9, 10, 11, 20, 21, 45, 70, 99].map(turkishNumber)).toEqual([
      'sıfır', 'bir', 'dokuz', 'on', 'on bir', 'yirmi', 'yirmi bir', 'kırk beş', 'yetmiş', 'doksan dokuz',
    ]);
  });

  it('refuses a number out of range', () => {
    expect(() => turkishNumber(100)).toThrow(RangeError);
    expect(() => turkishNumber(-1)).toThrow(RangeError);
    expect(() => turkishCardinal(1_000_000)).toThrow(RangeError);
    expect(() => turkishCardinal(0.5)).toThrow(RangeError);
  });

  it('leaves bir off a hundred and a thousand, also after another number', () => {
    expect([100, 101, 200, 1000, 1100, 2000, 2100].map(turkishCardinal)).toEqual([
      'yüz', 'yüz bir', 'iki yüz', 'bin', 'bin yüz', 'iki bin', 'iki bin yüz',
    ]);
  });

  it('joins hundreds, thousands and the rest with spaces and no and', () => {
    expect(turkishCardinal(1277)).toBe('bin iki yüz yetmiş yedi');
    expect(turkishCardinal(21_000)).toBe('yirmi bir bin');
    expect(turkishCardinal(100_000)).toBe('yüz bin');
    expect(turkishCardinal(999_999)).toBe('dokuz yüz doksan dokuz bin dokuz yüz doksan dokuz');
    expect(turkishCardinal(0)).toBe('sıfır');
  });
});
