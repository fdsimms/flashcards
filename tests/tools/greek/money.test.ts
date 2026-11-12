import { describe, expect, it } from 'vitest';
import { sayGreekMoney } from '../../../src/tools/greek/money';
import { greekCardinal } from '../../../src/tools/greek/numbers';

const say = (amount: number) => sayGreekMoney(amount);
const NBSP = ' ';

describe('numbers in Greek, past 99', () => {
  it('counts hundreds in the neuter and thousands in the feminine', () => {
    expect(greekCardinal(100)).toBe('εκατό');
    expect(greekCardinal(101)).toBe('εκατόν ένα');
    expect(greekCardinal(277)).toBe('διακόσια εβδομήντα εφτά');
    expect(greekCardinal(1000)).toBe('χίλια');
    expect(greekCardinal(1277)).toBe('χίλια διακόσια εβδομήντα εφτά');
    expect(greekCardinal(3000)).toBe('τρεις χιλιάδες');
    expect(greekCardinal(4500)).toBe('τέσσερις χιλιάδες πεντακόσια');
    expect(greekCardinal(10_000)).toBe('δέκα χιλιάδες');
    expect(greekCardinal(100_000)).toBe('εκατό χιλιάδες');
    expect(greekCardinal(101_000)).toBe('εκατόν μία χιλιάδες');
    expect(greekCardinal(200_000)).toBe('διακόσιες χιλιάδες');
    expect(() => greekCardinal(1_000_000)).toThrow(RangeError);
  });
});

describe('an amount of euros in Greek', () => {
  it('says whole euros', () => {
    expect(say(127700).everyday.text).toBe('χίλια διακόσια εβδομήντα εφτά ευρώ');
    expect(say(100).everyday.text).toBe('ένα ευρώ');
    expect(say(300).everyday.text).toBe('τρία ευρώ');
    expect(say(127700).also).toEqual([]);
  });

  it('says cents after the euros, or shorter at a till', () => {
    expect(say(1250).everyday.text).toBe('δώδεκα ευρώ και πενήντα λεπτά');
    expect(say(1250).also.map((p) => p.text)).toEqual(['δώδεκα και πενήντα']);
    expect(say(1250).also[0].note).toBeTruthy();
    expect(say(1201).everyday.text).toBe('δώδεκα ευρώ και ένα λεπτό');
  });

  it('says cents alone', () => {
    expect(say(50).everyday.text).toBe('πενήντα λεπτά');
    expect(say(1).everyday.text).toBe('ένα λεπτό');
  });

  it('romanizes every phrase', () => {
    expect(say(100).everyday.roman).toBe('éna evró');
  });

  it('writes it as a price tag does', () => {
    expect(say(127750).written.text).toBe(`1.277,50${NBSP}€`);
    expect(say(1200).written.text).toBe(`12${NBSP}€`);
  });

  it('refuses what is not an amount', () => {
    expect(() => say(0)).toThrow(RangeError);
  });
});
