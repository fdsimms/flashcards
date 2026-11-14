import { describe, expect, it } from 'vitest';
import { sayPolishMoney } from '../../../src/tools/polish/money';
import { polishCardinal, polishCountForm } from '../../../src/tools/polish/numbers';

const zl = (z: number, g = 0) => sayPolishMoney(z * 100 + g);
const N = ' ';

describe('złoty in Polish', () => {
  it('makes złoty agree with the number before it', () => {
    expect(zl(1).everyday.text).toBe('jeden złoty');
    expect(zl(2).everyday.text).toBe('dwa złote');
    expect(zl(4).everyday.text).toBe('cztery złote');
    expect(zl(5).everyday.text).toBe('pięć złotych');
    expect(zl(12).everyday.text).toBe('dwanaście złotych');
    expect(zl(21).everyday.text).toBe('dwadzieścia jeden złotych');
    expect(zl(22).everyday.text).toBe('dwadzieścia dwa złote');
    expect(zl(102).everyday.text).toBe('sto dwa złote');
    expect(zl(112).everyday.text).toBe('sto dwanaście złotych');
  });

  it('says thousands: tysiąc, dwa tysiące, pięć tysięcy', () => {
    expect(zl(1277).everyday.text).toBe('tysiąc dwieście siedemdziesiąt siedem złotych');
    expect(zl(2000).everyday.text).toBe('dwa tysiące złotych');
    expect(zl(5300).everyday.text).toBe('pięć tysięcy trzysta złotych');
    expect(zl(10000).everyday.text).toBe('dziesięć tysięcy złotych');
    expect(polishCardinal(22000)).toBe('dwadzieścia dwa tysiące');
    expect(polishCardinal(12000)).toBe('dwanaście tysięcy');
    expect(polishCardinal(0)).toBe('zero');
  });

  it('says grosze, and the shorter form at a till', () => {
    expect(zl(12, 50).everyday.text).toBe('dwanaście złotych pięćdziesiąt groszy');
    expect(zl(2, 1).everyday.text).toBe('dwa złote jeden grosz');
    expect(zl(2, 3).everyday.text).toBe('dwa złote trzy grosze');
    expect(zl(0, 50).everyday.text).toBe('pięćdziesiąt groszy');
    expect(zl(12, 50).also).toEqual([{ text: 'dwanaście pięćdziesiąt', note: 'As said at a checkout' }]);
    expect(zl(12).also).toEqual([]);
  });

  it('writes a price tag, with a narrow space between thousands', () => {
    expect(zl(1277, 50).written).toEqual({ text: `1${N}277,50${N}zł` });
    expect(zl(12).written.text).toBe(`12${N}zł`);
    expect(zl(0, 5).written.text).toBe(`0,05${N}zł`);
  });

  it('picks the noun form by Polish rules', () => {
    expect([1, 2, 5, 13, 21, 24, 104, 1000].map((n) => polishCountForm(n, 'one', 'few', 'many'))).toEqual([
      'one', 'few', 'many', 'many', 'many', 'few', 'few', 'many',
    ]);
  });

  it('refuses what is not an amount', () => {
    expect(() => sayPolishMoney(-5)).toThrow(RangeError);
    expect(() => polishCardinal(1_000_000)).toThrow(RangeError);
  });
});
