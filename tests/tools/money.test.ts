import { describe, expect, it } from 'vitest';
import { breakDown, CURRENCIES, MONEY_MAXES, parseTypedAmount, pieceLabel, randomAmount } from '../../src/tools/money';

describe('a random amount', () => {
  it('stays from one unit up to the most asked for, in the steps the currency is priced in', () => {
    for (const currency of Object.values(CURRENCIES)) {
      for (const max of MONEY_MAXES) {
        for (let i = 0; i < 100; i++) {
          const a = randomAmount(currency, max);
          expect(a).toBeGreaterThanOrEqual(currency.minorStep ? currency.minorStep : 100);
          expect(a).toBeLessThanOrEqual(max * 100);
          expect(a % (currency.minorStep || 100)).toBe(0);
        }
      }
    }
  });

  it('is whole baht, rubles and kroner', () => {
    for (const code of ['THB', 'RUB', 'NOK'] as const) {
      for (let i = 0; i < 50; i++) expect(randomAmount(CURRENCIES[code], 1000) % 100).toBe(0);
    }
  });

  it('can be whole or have a minor part, in pesos', () => {
    expect(randomAmount(CURRENCIES.MXN, 100, undefined, () => 0.99999)).toBe(10000);
    expect(randomAmount(CURRENCIES.MXN, 100, undefined, () => 0)).toBe(50);
    expect(randomAmount(CURRENCIES.EUR, 100, undefined, () => 0)).toBe(1);
  });

  it('never gives the previous amount again', () => {
    for (const currency of Object.values(CURRENCIES)) {
      let a = randomAmount(currency, 100);
      for (let i = 0; i < 200; i++) {
        const next = randomAmount(currency, 100, a);
        expect(next).not.toBe(a);
        a = next;
      }
    }
  });
});

describe('notes and coins', () => {
  it('make up the amount from the largest down', () => {
    expect(breakDown(127700, CURRENCIES.THB).map((p) => `${p.kind} ${p.value / 100}`)).toEqual([
      'note 1000', 'note 100', 'note 100', 'note 50', 'note 20', 'coin 5', 'coin 2',
    ]);
    expect(breakDown(1287, CURRENCIES.EUR).map((p) => p.value)).toEqual([1000, 200, 50, 20, 10, 5, 2]);
    expect(breakDown(2050, CURRENCIES.MXN).map((p) => `${p.kind} ${p.value}`)).toEqual(['note 2000', 'coin 50']);
  });

  it('can make every amount a random one can be', () => {
    for (const currency of Object.values(CURRENCIES)) {
      for (let i = 0; i < 200; i++) {
        const a = randomAmount(currency, 10000);
        expect(breakDown(a, currency).reduce((sum, p) => sum + p.value, 0)).toBe(a);
      }
    }
  });
});

describe("what's printed on a note or coin", () => {
  it('is the amount with the sign, or the minor unit for a small coin', () => {
    expect(pieceLabel(100000, CURRENCIES.THB)).toBe('1000 ฿');
    expect(pieceLabel(50, CURRENCIES.EUR)).toBe('50 c');
    expect(pieceLabel(200, CURRENCIES.PLN)).toBe('2 zł');
  });
});

describe('a price typed after hearing it', () => {
  const EUR = CURRENCIES.EUR;

  it('reads a comma or a dot before the cents', () => {
    expect(parseTypedAmount('12,49', EUR)).toBe(1249);
    expect(parseTypedAmount('12.49', EUR)).toBe(1249);
    expect(parseTypedAmount('12,5', EUR)).toBe(1250);
    expect(parseTypedAmount('0,05', EUR)).toBe(5);
    expect(parseTypedAmount('12', EUR)).toBe(1200);
  });

  it('takes any other comma, dot or space as grouping thousands, and ignores the sign', () => {
    expect(parseTypedAmount('1.277', EUR)).toBe(127700);
    expect(parseTypedAmount('1,277.50', CURRENCIES.MXN)).toBe(127750);
    expect(parseTypedAmount('1 277,50 €', EUR)).toBe(127750);
    expect(parseTypedAmount('1 277 zł', CURRENCIES.PLN)).toBe(127700);
    expect(parseTypedAmount('฿๑,๒๗๗', CURRENCIES.THB)).toBe(127700);
  });

  it('refuses what isn’t an amount', () => {
    expect(parseTypedAmount('', EUR)).toBeUndefined();
    expect(parseTypedAmount('twelve', EUR)).toBeUndefined();
    expect(parseTypedAmount('12,', EUR)).toBeUndefined();
    expect(parseTypedAmount('12,,49', EUR)).toBeUndefined();
  });
});
