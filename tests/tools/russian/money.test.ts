import { describe, expect, it } from 'vitest';
import { sayRussianMoney } from '../../../src/tools/russian/money';
import { russianCardinal } from '../../../src/tools/russian/numbers';

const rub = (r: number, k = 0) => sayRussianMoney(r * 100 + k);
const N = ' ';

describe('rubles in Russian', () => {
  it('makes рубль agree with the number before it', () => {
    expect(rub(1).everyday.text).toBe('один рубль');
    expect(rub(2).everyday.text).toBe('два рубля');
    expect(rub(5).everyday.text).toBe('пять рублей');
    expect(rub(11).everyday.text).toBe('одиннадцать рублей');
    expect(rub(21).everyday.text).toBe('двадцать один рубль');
    expect(rub(22).everyday.text).toBe('двадцать два рубля');
    expect(rub(112).everyday.text).toBe('сто двенадцать рублей');
  });

  it('says thousands, feminine: тысяча, две тысячи, пять тысяч', () => {
    expect(rub(1277).everyday.text).toBe('тысяча двести семьдесят семь рублей');
    expect(rub(2000).everyday.text).toBe('две тысячи рублей');
    expect(rub(5500).everyday.text).toBe('пять тысяч пятьсот рублей');
    expect(rub(10000).everyday.text).toBe('десять тысяч рублей');
    expect(russianCardinal(21000)).toBe('двадцать одна тысяча');
    expect(russianCardinal(0)).toBe('ноль');
  });

  it('gives одна тысяча as another way to say 1000 to 1999', () => {
    expect(rub(1277).also.map((p) => p.text)).toEqual(['одна тысяча двести семьдесят семь рублей']);
    expect(rub(2000).also).toEqual([]);
    expect(rub(999).also).toEqual([]);
  });

  it('says kopecks, feminine, and the shorter form at a till', () => {
    expect(rub(12, 50).everyday.text).toBe('двенадцать рублей пятьдесят копеек');
    expect(rub(3, 1).everyday.text).toBe('три рубля одна копейка');
    expect(rub(3, 2).everyday.text).toBe('три рубля две копейки');
    expect(rub(0, 50).everyday.text).toBe('пятьдесят копеек');
    expect(rub(12, 50).also).toEqual([{ text: 'двенадцать пятьдесят', roman: 'dvenadtsat\' pyat\'desyat', note: 'As said at a checkout' }]);
  });

  it('writes a price tag, with a narrow space between thousands', () => {
    expect(rub(1277).written).toEqual({ text: `1${N}277${N}₽` });
    expect(rub(12, 5).written.text).toBe(`12,05${N}₽`);
    expect(rub(999).written.text).toBe(`999${N}₽`);
  });

  it('romanizes what is said', () => {
    expect(rub(2).everyday.roman).toBe('dva rublya');
  });

  it('refuses what is not an amount', () => {
    expect(() => sayRussianMoney(-1)).toThrow(RangeError);
    expect(() => sayRussianMoney(1.5)).toThrow(RangeError);
    expect(() => russianCardinal(1_000_000)).toThrow(RangeError);
  });
});
