import { describe, expect, it } from 'vitest';
import { sayGermanMoney } from '../../../src/tools/german/money';
import { germanCardinal } from '../../../src/tools/german/numbers';

const say = (amount: number) => sayGermanMoney(amount);
const NBSP = ' ';

describe('numbers in German, past 99', () => {
  it('writes them as one word', () => {
    expect(germanCardinal(100)).toBe('hundert');
    expect(germanCardinal(101)).toBe('hunderteins');
    expect(germanCardinal(1277)).toBe('tausendzweihundertsiebenundsiebzig');
    expect(germanCardinal(2000)).toBe('zweitausend');
    expect(germanCardinal(21_000)).toBe('einundzwanzigtausend');
    expect(germanCardinal(10_000)).toBe('zehntausend');
    expect(() => germanCardinal(1_000_000)).toThrow(RangeError);
  });
});

describe('an amount of euros in German', () => {
  it('says whole euros with no plural', () => {
    expect(say(127700).everyday.text).toBe('tausendzweihundertsiebenundsiebzig Euro');
    expect(say(100).everyday.text).toBe('ein Euro');
    expect(say(2100).everyday.text).toBe('einundzwanzig Euro');
    expect(say(10100).everyday.text).toBe('hundertein Euro');
  });

  it('reads the cents after the euros, or in full', () => {
    expect(say(1250).everyday.text).toBe('zwölf Euro fünfzig');
    expect(say(1250).also.map((p) => p.text)).toEqual(['zwölf Euro und fünfzig Cent']);
    expect(say(1201).everyday.text).toBe('zwölf Euro eins');
    expect(say(1201).also[0].text).toBe('zwölf Euro und ein Cent');
  });

  it('says cents alone', () => {
    expect(say(50).everyday.text).toBe('fünfzig Cent');
    expect(say(1).everyday.text).toBe('ein Cent');
  });

  it('gives eintausend and einhundert as other ways', () => {
    expect(say(127700).also.map((p) => p.text)).toEqual(['eintausendzweihundertsiebenundsiebzig Euro']);
    expect(say(15000).also.map((p) => p.text)).toEqual(['einhundertfünfzig Euro']);
    expect(say(1200).also).toEqual([]);
  });

  it('writes it as a price tag does', () => {
    expect(say(127750).written.text).toBe(`1.277,50${NBSP}€`);
    expect(say(1250).written.text).toBe(`12,50${NBSP}€`);
    expect(say(1200).written.text).toBe(`12${NBSP}€`);
    expect(say(5).written.text).toBe(`0,05${NBSP}€`);
  });

  it('refuses what is not an amount', () => {
    expect(() => say(0)).toThrow(RangeError);
    expect(() => say(1.5)).toThrow(RangeError);
  });
});
