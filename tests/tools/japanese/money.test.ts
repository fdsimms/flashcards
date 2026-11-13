import { describe, expect, it } from 'vitest';
import { sayJapaneseMoney } from '../../../src/tools/japanese/money';

// Amounts are in the currency's minor units, 100 to the yen (src/tools/money.ts).
const yen = (n: number) => sayJapaneseMoney(n * 100);

describe('an amount in Japanese', () => {
  it('says the number and 円, with its reading', () => {
    expect(yen(1277).everyday).toEqual({ text: '千二百七十七円', roman: 'せんにひゃくななじゅうななえん' });
    expect(yen(4).everyday.roman).toBe('よえん');
    expect(yen(10000).everyday.text).toBe('一万円');
  });

  it('writes digits with commas and 円 after them', () => {
    expect(yen(1277).written.text).toBe('1,277円');
  });

  it('refuses an amount that is not whole yen', () => {
    expect(() => sayJapaneseMoney(150)).toThrow(RangeError);
    expect(() => sayJapaneseMoney(0)).toThrow(RangeError);
  });
});
