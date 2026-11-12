import { describe, expect, it } from 'vitest';
import { frenchNumber } from '../../../src/tools/french/numbers';
import { sayFrenchMoney } from '../../../src/tools/french/money';

const euros = (n: number) => sayFrenchMoney(n * 100);

describe('numbers in French past 59', () => {
  it('says seventies, eighties and nineties, hundreds and thousands', () => {
    expect([60, 70, 71, 72, 80, 81, 90, 91, 99, 100, 101, 180, 200, 201, 1000, 1001, 2026, 80000, 200000].map((n) => frenchNumber(n))).toEqual([
      'soixante', 'soixante-dix', 'soixante et onze', 'soixante-douze', 'quatre-vingts', 'quatre-vingt-un', 'quatre-vingt-dix',
      'quatre-vingt-onze', 'quatre-vingt-dix-neuf', 'cent', 'cent un', 'cent quatre-vingts', 'deux cents', 'deux cent un',
      'mille', 'mille un', 'deux mille vingt-six', 'quatre-vingt mille', 'deux cent mille',
    ]);
    expect(frenchNumber(81, true)).toBe('quatre-vingt-une');
  });
});

describe('an amount in euros', () => {
  it('counts euros, with the plural from two', () => {
    expect([1, 2, 21, 71, 80, 81, 200, 1000, 10000].map((n) => euros(n).everyday.text)).toEqual([
      'un euro', 'deux euros', 'vingt et un euros', 'soixante et onze euros', 'quatre-vingts euros', 'quatre-vingt-un euros',
      'deux cents euros', 'mille euros', 'dix mille euros',
    ]);
    expect(euros(1277).everyday.text).toBe('mille deux cent soixante-dix-sept euros');
  });

  it('reads cents after the euros, with centimes in full as another way', () => {
    const s = sayFrenchMoney(1250);
    expect(s.everyday.text).toBe('douze euros cinquante');
    expect(s.also.map((p) => p.text)).toEqual(['douze euros et cinquante centimes']);
    expect(sayFrenchMoney(101).also.map((p) => p.text)).toEqual(['un euro et un centime']);
    expect(sayFrenchMoney(50).everyday.text).toBe('cinquante centimes');
    expect(sayFrenchMoney(1).everyday.text).toBe('un centime');
  });

  it('writes it as French typography does', () => {
    expect(euros(1277).written.text).toBe('1 277 €');
    expect(sayFrenchMoney(127750).written.text).toBe('1 277,50 €');
    expect(sayFrenchMoney(1250).written.text).toBe('12,50 €');
    expect(sayFrenchMoney(5).written.text).toBe('0,05 €');
  });

  it('refuses an amount that is not one', () => {
    expect(() => sayFrenchMoney(-100)).toThrow(RangeError);
  });
});
