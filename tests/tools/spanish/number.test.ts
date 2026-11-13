import { describe, expect, it } from 'vitest';
import { saySpanishNumber } from '../../../src/tools/spanish/number';

describe('a number in Spanish', () => {
  it('says a plain number and a year', () => {
    expect(saySpanishNumber({ kind: 'number', n: 21_000 }).everyday.text).toBe('veintiún mil');
    expect(saySpanishNumber({ kind: 'year', n: 1987 }).everyday.text).toBe('mil novecientos ochenta y siete');
  });

  it('reads a phone number in pairs, a pair starting with 0 as cero and the digit', () => {
    const s = saySpanishNumber({ kind: 'phone', written: '55 1205 7800' });
    expect(s.everyday.text).toBe('cincuenta y cinco, doce, cero cinco, setenta y ocho, cero cero');
    expect(s.also).toEqual([{ text: 'cinco cinco, uno dos cero cinco, siete ocho cero cero', note: 'Digit by digit' }]);
  });

  it('says an age with tengo, uno cut to un before años', () => {
    expect(saySpanishNumber({ kind: 'age', n: 21 }).everyday.text).toBe('tengo veintiún años');
    expect(saySpanishNumber({ kind: 'age', n: 31 }).everyday.text).toBe('tengo treinta y un años');
  });
});
