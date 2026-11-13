import { describe, expect, it } from 'vitest';
import { sayPolishNumber } from '../../../src/tools/polish/number';
import { yearOrdinal } from '../../../src/tools/polish/numbers';

describe('a number in Polish', () => {
  it('reads a phone number in its threes, a leading 0 one by one', () => {
    const s = sayPolishNumber({ kind: 'phone', written: '512 045 678' });
    expect(s.everyday.text).toBe('pięćset dwanaście, zero czterdzieści pięć, sześćset siedemdziesiąt osiem');
    expect(s.also).toEqual([{ text: 'pięć jeden dwa, zero cztery pięć, sześć siedem osiem', note: 'Digit by digit' }]);
  });

  it('says a year as an ordinal, and in a year after w', () => {
    expect([1987, 2000, 2026, 1900].map((y) => yearOrdinal(y, 'nominative')))
      .toEqual(['tysiąc dziewięćset osiemdziesiąty siódmy', 'dwutysięczny', 'dwa tysiące dwudziesty szósty', 'tysiąc dziewięćsetny']);
    expect([1987, 2000, 2003].map((y) => yearOrdinal(y, 'locative')))
      .toEqual(['tysiąc dziewięćset osiemdziesiątym siódmym', 'dwutysięcznym', 'dwa tysiące trzecim']);
    const s = sayPolishNumber({ kind: 'year', n: 1987 });
    expect(s.everyday.text).toBe('tysiąc dziewięćset osiemdziesiąty siódmy');
    expect(s.also).toEqual([{ text: 'w tysiąc dziewięćset osiemdziesiątym siódmym roku', note: 'In 1987' }]);
  });

  it('says an age with mam, lata after 2 to 4 but not 12 to 14, lat after the rest', () => {
    expect([22, 12, 25, 21, 34].map((n) => sayPolishNumber({ kind: 'age', n }).everyday.text))
      .toEqual(['mam dwadzieścia dwa lata', 'mam dwanaście lat', 'mam dwadzieścia pięć lat', 'mam dwadzieścia jeden lat', 'mam trzydzieści cztery lata']);
  });
});
