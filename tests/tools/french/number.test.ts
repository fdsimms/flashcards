import { describe, expect, it } from 'vitest';
import { sayFrenchNumber } from '../../../src/tools/french/number';
import { frenchNumber } from '../../../src/tools/french/numbers';

describe('a number in French', () => {
  it('counts the seventies and nineties as Belgium and Switzerland do, when asked', () => {
    expect([70, 71, 72, 77, 80, 90, 91, 99].map((n) => frenchNumber(n, false, true)))
      .toEqual(['septante', 'septante et un', 'septante-deux', 'septante-sept', 'quatre-vingts', 'nonante', 'nonante et un', 'nonante-neuf']);
    expect(frenchNumber(1975, false, true)).toBe('mille neuf cent septante-cinq');
    expect(frenchNumber(1975)).toBe('mille neuf cent soixante-quinze');
  });

  it('offers the Belgian form only when it differs', () => {
    expect(sayFrenchNumber({ kind: 'number', n: 1971 }).also).toEqual([{ text: 'mille neuf cent septante et un', note: 'Belgium and Switzerland' }]);
    expect(sayFrenchNumber({ kind: 'number', n: 1987 }).also).toEqual([]);
  });

  it('reads a phone number in pairs', () => {
    expect(sayFrenchNumber({ kind: 'phone', written: '06 42 17 85 93' }).everyday.text).toBe('zéro six, quarante-deux, dix-sept, quatre-vingt-cinq, quatre-vingt-treize');
  });

  it('says a year, with the hundreds heard too before 2000', () => {
    const s = sayFrenchNumber({ kind: 'year', n: 1987 });
    expect(s.everyday.text).toBe('mille neuf cent quatre-vingt-sept');
    expect(s.also).toEqual([{ text: 'dix-neuf cent quatre-vingt-sept', note: 'In hundreds, heard too' }]);
    expect(sayFrenchNumber({ kind: 'year', n: 2026 }).also).toEqual([]);
  });

  it("says an age with j'ai and ans", () => {
    expect(sayFrenchNumber({ kind: 'age', n: 21 }).everyday.text).toBe("j'ai vingt et un ans");
    expect(sayFrenchNumber({ kind: 'age', n: 80 }).everyday.text).toBe("j'ai quatre-vingts ans");
  });
});
