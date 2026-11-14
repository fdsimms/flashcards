import { describe, expect, it } from 'vitest';
import { greekNumber } from '../../../src/tools/greek/numbers';
import { sayGreekTime } from '../../../src/tools/greek/time';
import { greekRoman } from '../../../src/tools/greek/translit';

const everyday = (hour: number, minute = 0) => sayGreekTime({ hour, minute }).everyday.text;
const also = (hour: number, minute = 0) => sayGreekTime({ hour, minute }).also.map((p) => p.text);
const formal = (hour: number, minute = 0) => sayGreekTime({ hour, minute }).formal.text;

describe('Greek numbers', () => {
  it('agrees 1, 3 and 4 with the gender, in the units of a compound too', () => {
    expect([1, 3, 4, 13, 14, 21, 23, 24].map((n) => greekNumber(n, 'feminine'))).toEqual([
      'μία', 'τρεις', 'τέσσερις', 'δεκατρείς', 'δεκατέσσερις', 'είκοσι μία', 'είκοσι τρεις', 'είκοσι τέσσερις',
    ]);
    expect([1, 3, 4, 13, 14, 21, 23, 24].map((n) => greekNumber(n, 'neuter'))).toEqual([
      'ένα', 'τρία', 'τέσσερα', 'δεκατρία', 'δεκατέσσερα', 'είκοσι ένα', 'είκοσι τρία', 'είκοσι τέσσερα',
    ]);
  });

  it('says the rest the same in either gender', () => {
    expect([0, 7, 8, 9, 17, 20, 30, 59].map((n) => greekNumber(n, 'neuter'))).toEqual([
      'μηδέν', 'εφτά', 'οχτώ', 'εννιά', 'δεκαεφτά', 'είκοσι', 'τριάντα', 'πενήντα εννιά',
    ]);
  });

  it('refuses a number out of range', () => {
    expect(() => greekNumber(100, 'neuter')).toThrow(RangeError);
  });
});

describe('Greek in Latin letters', () => {
  it('reads letters and digraphs as they sound, keeping the stress', () => {
    expect(greekRoman('δύο και μισή')).toBe('dío ke misí');
    expect(greekRoman('τρεις παρά τέταρτο')).toBe('tris pará tétarto');
    expect(greekRoman('το απόγευμα')).toBe('to apóyevma');
    expect(greekRoman('πέντε')).toBe('pénde');
    expect(greekRoman('έντεκα')).toBe('éndeka');
    expect(greekRoman('το πρωί')).toBe('to proí');
    expect(greekRoman('τη νύχτα')).toBe('ti níhta');
    expect(greekRoman('μεσημέρι')).toBe('mesiméri');
    expect(greekRoman('ούτε')).toBe('oúte');
    expect(greekRoman('μπάλα ντομάτα γκολ')).toBe('bála domáta gol');
    expect(greekRoman('άγγελος')).toBe('ángelos');
    expect(greekRoman('ευχαριστώ')).toBe('efharistó');
    expect(greekRoman('γεια')).toBe('yia');
    expect(greekRoman('Είναι')).toBe('íne');
    expect(greekRoman('κοροϊδεύω')).toBe('koroidévo');
  });
});

describe('a time in Greek', () => {
  it('says the hour on a 12-hour clock, in the feminine', () => {
    expect(everyday(14)).toBe('δύο');
    expect(everyday(13)).toBe('μία');
    expect(everyday(15)).toBe('τρεις');
    expect(everyday(4)).toBe('τέσσερις');
    expect(also(13)).toEqual(['μία το μεσημέρι', 'μία η ώρα']);
    expect(also(12)).toEqual(['δώδεκα το μεσημέρι', 'δώδεκα η ώρα', 'μεσημέρι']);
    expect(also(0)).toEqual(['δώδεκα τα μεσάνυχτα', 'δώδεκα η ώρα', 'μεσάνυχτα']);
  });

  it('counts past the hour with και up to the half', () => {
    expect(everyday(14, 1)).toBe('δύο και ένα');
    expect(everyday(14, 10)).toBe('δύο και δέκα');
    expect(everyday(14, 15)).toBe('δύο και τέταρτο');
    expect(everyday(14, 23)).toBe('δύο και είκοσι τρία');
    expect(everyday(14, 30)).toBe('δύο και μισή');
    expect(everyday(15, 30)).toBe('τρεις και μισή');
  });

  it('reads :31 to :34 off the digits, with παρά as another way', () => {
    expect(everyday(14, 32)).toBe('δύο και τριάντα δύο');
    expect(also(14, 32)).toContain('τρεις παρά είκοσι οχτώ');
  });

  it('counts to the next hour with παρά from :35', () => {
    expect(everyday(14, 35)).toBe('τρεις παρά είκοσι πέντε');
    expect(everyday(14, 45)).toBe('τρεις παρά τέταρτο');
    expect(everyday(14, 50)).toBe('τρεις παρά δέκα');
    expect(everyday(12, 45)).toBe('μία παρά τέταρτο');
    expect(everyday(23, 59)).toBe('δώδεκα παρά ένα');
    expect(everyday(2, 57)).toBe('τρεις παρά τρία');
  });

  it('adds the part of the day as another way to say it', () => {
    expect(also(3, 30)).toEqual(['τρεις και μισή τη νύχτα']);
    expect(also(9, 15)).toEqual(['εννιά και τέταρτο το πρωί']);
    expect(also(16, 45)).toEqual(['πέντε παρά τέταρτο το απόγευμα']);
    expect(also(20, 10)).toEqual(['οχτώ και δέκα το βράδυ']);
    expect(also(23, 30)).toEqual(['έντεκα και μισή το βράδυ']);
    expect(also(0, 30)).toEqual(['δώδεκα και μισή τη νύχτα']);
  });

  it('gives the formal 24-hour form', () => {
    expect(formal(14, 30)).toBe('δεκατέσσερις και τριάντα');
    expect(formal(13, 1)).toBe('δεκατρείς και ένα');
    expect(formal(21, 15)).toBe('είκοσι μία και δεκαπέντε');
    expect(formal(14)).toBe('δεκατέσσερις μηδέν μηδέν');
    expect(formal(0)).toBe('μηδέν μηδέν');
    expect(formal(0, 30)).toBe('μηδέν και τριάντα');
  });

  it('romanizes every phrase', () => {
    const s = sayGreekTime({ hour: 14, minute: 30 });
    expect(s.everyday.roman).toBe('dío ke misí');
    expect(s.formal.roman).toBe('dekatésseris ke triánda');
    expect(s.also.every((p) => !!p.roman)).toBe(true);
  });

  it('refuses what is not a time of day', () => {
    expect(() => sayGreekTime({ hour: 24, minute: 0 })).toThrow(RangeError);
    expect(() => sayGreekTime({ hour: 3, minute: -1 })).toThrow(RangeError);
  });
});
