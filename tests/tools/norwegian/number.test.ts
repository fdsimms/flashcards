import { describe, expect, it } from 'vitest';
import { sayNorwegianNumber } from '../../../src/tools/norwegian/number';

describe('a number in Norwegian', () => {
  it('says a number, with ett tusen heard too', () => {
    const s = sayNorwegianNumber({ kind: 'number', n: 1971 });
    expect(s.everyday.text).toBe('tusen ni hundre og syttien');
    expect(s.also.map((p) => p.text)).toEqual(['ett tusen ni hundre og syttien']);
  });

  it('reads a phone number digit by digit', () => {
    expect(sayNorwegianNumber({ kind: 'phone', written: '412 34 567' }).everyday.text).toBe('fire en to, tre fire, fem seks sju');
  });

  it('says a year as one word, with the shorter one heard in speech', () => {
    const s = sayNorwegianNumber({ kind: 'year', n: 1987 });
    expect(s.everyday.text).toBe('nittenhundreogåttisju');
    expect(s.also).toEqual([{ text: 'nittenåttisju', note: 'Shorter, in speech' }]);
  });

  it('says an age with jeg er, with år or without', () => {
    const s = sayNorwegianNumber({ kind: 'age', n: 34 });
    expect([s.everyday, ...s.also].map((p) => p.text)).toEqual(['jeg er trettifire år', 'jeg er trettifire']);
  });
});
