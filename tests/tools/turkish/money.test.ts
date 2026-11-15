import { describe, expect, it } from 'vitest';
import { sayTurkishMoney } from '../../../src/tools/turkish/money';

const everyday = (amount: number) => sayTurkishMoney(amount).everyday.text;
const also = (amount: number) => sayTurkishMoney(amount).also.map((p) => p.text);
const written = (amount: number) => sayTurkishMoney(amount).written.text;

describe('an amount of Turkish lira', () => {
  it('says lira and kuruş, both singular after a number', () => {
    expect(everyday(100)).toBe('bir lira');
    expect(everyday(1200)).toBe('on iki lira');
    expect(everyday(127_750)).toBe('bin iki yüz yetmiş yedi lira elli kuruş');
    expect(everyday(1205)).toBe('on iki lira beş kuruş');
    expect(everyday(25)).toBe('yirmi beş kuruş');
  });

  it('says 50 kuruş after lira as buçuk, a half', () => {
    expect(also(150)).toEqual(['bir buçuk lira']);
    expect(also(1250)).toEqual(['on iki buçuk lira']);
    expect(also(127_750)).toEqual(['bin iki yüz yetmiş yedi buçuk lira']);
    expect(also(50)).toEqual([]);
    expect(also(1225)).toEqual([]);
    expect(also(1200)).toEqual([]);
  });

  it('writes the price with a dot between thousands and a comma before the kuruş', () => {
    expect(written(127_750)).toBe('1.277,50 TL');
    expect(written(1200)).toBe('12 TL');
    expect(written(1205)).toBe('12,05 TL');
    expect(written(50)).toBe('0,50 TL');
    expect(written(100_000_000 - 1)).toBe('999.999,99 TL');
  });

  it('refuses an amount that is not one', () => {
    expect(() => sayTurkishMoney(0)).toThrow(RangeError);
    expect(() => sayTurkishMoney(1.5)).toThrow(RangeError);
    expect(() => sayTurkishMoney(100_000_000)).toThrow(RangeError);
  });
});
