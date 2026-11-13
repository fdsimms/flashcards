import { describe, expect, it } from 'vitest';
import { sayNorwegianMoney } from '../../../src/tools/norwegian/money';
import { norwegianCardinal } from '../../../src/tools/norwegian/numbers';

const say = (amount: number) => sayNorwegianMoney(amount);
const NBSP = ' ';

describe('numbers in Norwegian, past 99', () => {
  it('says them in separate words, og before the last part under 100', () => {
    expect(norwegianCardinal(100)).toBe('hundre');
    expect(norwegianCardinal(277)).toBe('to hundre og syttisju');
    expect(norwegianCardinal(1005)).toBe('tusen og fem');
    expect(norwegianCardinal(1277)).toBe('tusen to hundre og syttisju');
    expect(norwegianCardinal(2300)).toBe('to tusen tre hundre');
    expect(norwegianCardinal(10_000)).toBe('ti tusen');
    expect(() => norwegianCardinal(1_000_000)).toThrow(RangeError);
  });
  it('says ett hundre after thousands', () => {
    expect(norwegianCardinal(1100)).toBe('tusen ett hundre');
    expect(norwegianCardinal(1150)).toBe('tusen ett hundre og femti');
    expect(norwegianCardinal(21_100)).toBe('tjueen tusen ett hundre');
    expect(norwegianCardinal(100_100)).toBe('hundre tusen ett hundre');
    expect(norwegianCardinal(150)).toBe('hundre og femti');
  });
});

describe('an amount of kroner in Norwegian', () => {
  it('says whole kroner', () => {
    expect(say(127700).everyday.text).toBe('tusen to hundre og syttisju kroner');
    expect(say(100).everyday.text).toBe('én krone');
    expect(say(2100).everyday.text).toBe('tjueen kroner');
  });

  it('gives ett tusen and ett hundre as other ways', () => {
    expect(say(127700).also.map((p) => p.text)).toEqual(['ett tusen to hundre og syttisju kroner']);
    expect(say(15000).also.map((p) => p.text)).toEqual(['ett hundre og femti kroner']);
    expect(say(2100).also).toEqual([]);
    expect(say(115000).everyday.text).toBe('tusen ett hundre og femti kroner');
    expect(say(115000).also.map((p) => p.text)).toEqual(['ett tusen ett hundre og femti kroner']);
  });

  it('says øre after the kroner, or shorter at a till', () => {
    expect(say(1250).everyday.text).toBe('tolv kroner og femti øre');
    expect(say(1250).also.map((p) => p.text)).toEqual(['tolv femti']);
    expect(say(1250).also[0].note).toBeTruthy();
    expect(say(150).also.map((p) => p.text)).toEqual(['en femti']);
    expect(say(150).everyday.text).toBe('én krone og femti øre');
  });

  it('says øre alone', () => {
    expect(say(50).everyday.text).toBe('femti øre');
    expect(say(1).everyday.text).toBe('ett øre');
  });

  it('writes it as a price tag does', () => {
    expect(say(127700).written.text).toBe(`1${NBSP}277${NBSP}kr`);
    expect(say(1250).written.text).toBe(`12,50${NBSP}kr`);
    expect(say(1200).written.text).toBe(`12${NBSP}kr`);
  });

  it('refuses what is not an amount', () => {
    expect(() => say(0)).toThrow(RangeError);
  });
});
