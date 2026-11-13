import { describe, expect, it } from 'vitest';
import { greekGenitive, sayGreekNumber } from '../../../src/tools/greek/number';

describe('a number in Greek', () => {
  it('says a number and a year, neuter, with a romanization', () => {
    expect(sayGreekNumber({ kind: 'number', n: 21_000 }).everyday.text).toBe('είκοσι μία χιλιάδες');
    expect(sayGreekNumber({ kind: 'year', n: 1987 }).everyday).toEqual({ text: 'χίλια εννιακόσια ογδόντα εφτά', roman: 'hília enniakósia ogdónda eftá' });
  });

  it('reads a phone number digit by digit', () => {
    expect(sayGreekNumber({ kind: 'phone', written: '690 123 4567' }).everyday.text)
      .toBe('έξι εννιά μηδέν, ένα δύο τρία, τέσσερα πέντε έξι εφτά');
  });

  it('says an age in the genitive: only 1, 3 and 4 change', () => {
    expect([1, 3, 4, 13, 14, 21, 33, 34, 11, 25].map(greekGenitive))
      .toEqual(['ενός', 'τριών', 'τεσσάρων', 'δεκατριών', 'δεκατεσσάρων', 'είκοσι ενός', 'τριάντα τριών', 'τριάντα τεσσάρων', 'έντεκα', 'είκοσι πέντε']);
    expect(sayGreekNumber({ kind: 'age', n: 34 }).everyday.text).toBe('είμαι τριάντα τεσσάρων χρονών');
  });
});
