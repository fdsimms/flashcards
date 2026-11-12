import { describe, expect, it } from 'vitest';
import { spanishNumber } from '../../../src/tools/spanish/numbers';
import { saySpanishMoney } from '../../../src/tools/spanish/money';

const pesos = (n: number) => saySpanishMoney(n * 100);

describe('numbers in Spanish past 59', () => {
  it('says hundreds and thousands', () => {
    expect([71, 81, 99, 100, 101, 180, 200, 500, 777, 1000, 1001, 2026, 1958, 21000, 100000].map((n) => spanishNumber(n))).toEqual([
      'setenta y uno', 'ochenta y uno', 'noventa y nueve', 'cien', 'ciento uno', 'ciento ochenta', 'doscientos', 'quinientos',
      'setecientos setenta y siete', 'mil', 'mil uno', 'dos mil veintiséis', 'mil novecientos cincuenta y ocho', 'veintiún mil', 'cien mil',
    ]);
    expect(spanishNumber(200, true)).toBe('doscientas');
  });
});

describe('an amount in Mexican pesos', () => {
  it('counts pesos with uno cut to un', () => {
    expect([1, 21, 31, 71, 80, 100, 200, 1000, 1001, 10000].map((n) => pesos(n).everyday.text)).toEqual([
      'un peso', 'veintiún pesos', 'treinta y un pesos', 'setenta y un pesos', 'ochenta pesos', 'cien pesos', 'doscientos pesos',
      'mil pesos', 'mil un pesos', 'diez mil pesos',
    ]);
    expect(pesos(1277).everyday.text).toBe('mil doscientos setenta y siete pesos');
  });

  it('says centavos after con, or read off a price after the pesos', () => {
    const s = saySpanishMoney(127750);
    expect(s.everyday.text).toBe('mil doscientos setenta y siete pesos con cincuenta centavos');
    expect(s.also.map((p) => p.text)).toEqual(['mil doscientos setenta y siete pesos cincuenta']);
    expect(saySpanishMoney(101).everyday.text).toBe('un peso con un centavo');
    expect(saySpanishMoney(50).everyday.text).toBe('cincuenta centavos');
    expect(saySpanishMoney(50).also).toEqual([]);
  });

  it('writes it as a Mexican price', () => {
    expect(pesos(1277).written.text).toBe('$1,277');
    expect(saySpanishMoney(127750).written.text).toBe('$1,277.50');
    expect(saySpanishMoney(5).written.text).toBe('$0.05');
  });

  it('refuses an amount that is not one', () => {
    expect(() => saySpanishMoney(0)).toThrow(RangeError);
  });
});
