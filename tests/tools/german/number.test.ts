import { describe, expect, it } from 'vitest';
import { sayGermanNumber } from '../../../src/tools/german/number';

describe('a number in German', () => {
  it('says a number as one word, with ein at the start heard too', () => {
    const s = sayGermanNumber({ kind: 'number', n: 1100 });
    expect(s.everyday.text).toBe('tausendhundert');
    expect(s.also.map((p) => p.text)).toEqual(['eintausendeinhundert']);
    expect(sayGermanNumber({ kind: 'number', n: 87 }).also).toEqual([]);
  });

  it('reads a phone number digit by digit, with zwo for 2 heard too', () => {
    const s = sayGermanNumber({ kind: 'phone', written: '0151 2345' });
    expect(s.everyday.text).toBe('null eins fünf eins, zwei drei vier fünf');
    expect(s.also.map((p) => p.text)).toEqual(['null eins fünf eins, zwo drei vier fünf']);
    expect(sayGermanNumber({ kind: 'phone', written: '0151 3456' }).also).toEqual([]);
  });

  it('says a year in hundreds before 2000', () => {
    expect(sayGermanNumber({ kind: 'year', n: 1987 }).everyday.text).toBe('neunzehnhundertsiebenundachtzig');
    expect(sayGermanNumber({ kind: 'year', n: 2026 }).everyday.text).toBe('zweitausendsechsundzwanzig');
  });

  it('says an age with ich bin, and with Jahre alt', () => {
    const s = sayGermanNumber({ kind: 'age', n: 34 });
    expect([s.everyday, ...s.also].map((p) => p.text)).toEqual(['ich bin vierunddreißig', 'ich bin vierunddreißig Jahre alt']);
  });
});
