import { describe, expect, it } from 'vitest';
import { FIRST_YEAR, LAST_YEAR } from '../../src/tools/date';
import {
  answerDigits, checkDigits, digitByDigit, fillPhone, groupAsNumber, groupThousands, MAX_AGE, MAX_NUMBER, MIN_AGE, PHONE_FORMATS, phoneGroups,
  questionKey, questionText, randomQuestion, type NumberQuestion,
} from '../../src/tools/number';
import { TOOL_LANGUAGES } from '../../src/tools/tools';

const sequence = (...values: number[]) => () => values.shift() ?? 0;

describe('the number on the question card', () => {
  it('groups thousands as the language writes them', () => {
    expect(groupThousands(1277, 'th')).toBe('1,277');
    expect(groupThousands(482_315, 'de')).toBe('482.315');
    expect(groupThousands(1277, 'fr')).toBe('1 277');
    expect(groupThousands(1277, 'nb')).toBe('1 277');
    expect(groupThousands(999, 'pl')).toBe('999');
  });

  it('writes a year without a separator, and a Thai one in the Buddhist Era', () => {
    expect(questionText({ kind: 'year', n: 1987 }, 'de')).toBe('1987');
    expect(questionText({ kind: 'year', n: 1987 }, 'th')).toBe('พ.ศ. 2530');
    expect(answerDigits({ kind: 'year', n: 1987 }, 'th')).toBe('2530');
  });

  it('writes a phone number as it was made', () => {
    expect(questionText({ kind: 'phone', written: '06 42 17 85 93' }, 'fr')).toBe('06 42 17 85 93');
    expect(answerDigits({ kind: 'phone', written: '8 912 345-67-89' }, 'ru')).toBe('89123456789');
  });
});

describe('checking the digits heard', () => {
  const phone: NumberQuestion = { kind: 'phone', written: '06 42 17 85 93' };

  it('ignores spaces, dashes and separators', () => {
    expect(checkDigits('0642178593', phone, 'fr')).toBe(true);
    expect(checkDigits('06-42-17-85-93', phone, 'fr')).toBe(true);
    expect(checkDigits('482.315', { kind: 'number', n: 482_315 }, 'de')).toBe(true);
  });

  it('takes Thai and full-width digits as 0 to 9', () => {
    expect(checkDigits('๒๕๓๐', { kind: 'year', n: 1987 }, 'th')).toBe(true);
    expect(checkDigits('１９８７', { kind: 'year', n: 1987 }, 'ja')).toBe(true);
  });

  it('refuses a wrong digit, a missing one, and nothing at all', () => {
    expect(checkDigits('0642178598', phone, 'fr')).toBe(false);
    expect(checkDigits('064217859', phone, 'fr')).toBe(false);
    expect(checkDigits(' - ', phone, 'fr')).toBe(false);
    // A Thai year is the Buddhist one shown, not the Christian one.
    expect(checkDigits('1987', { kind: 'year', n: 1987 }, 'th')).toBe(false);
  });
});

describe('a random question', () => {
  it('stays in range for every kind', () => {
    for (let i = 0; i < 500; i++) {
      const n = randomQuestion('number', 'de') as { n: number };
      expect(n.n).toBeGreaterThanOrEqual(0);
      expect(n.n).toBeLessThanOrEqual(MAX_NUMBER);
      const y = randomQuestion('year', 'de') as { n: number };
      expect(y.n).toBeGreaterThanOrEqual(FIRST_YEAR);
      expect(y.n).toBeLessThanOrEqual(LAST_YEAR);
      const a = randomQuestion('age', 'de') as { n: number };
      expect(a.n).toBeGreaterThanOrEqual(MIN_AGE);
      expect(a.n).toBeLessThanOrEqual(MAX_AGE);
    }
  });

  it('picks how many digits a number has first, so a one-digit number comes up as often as a six-digit one', () => {
    expect(randomQuestion('number', 'de', undefined, sequence(0, 0.5))).toEqual({ kind: 'number', n: 5 });
    expect(randomQuestion('number', 'de', undefined, sequence(0.99, 0))).toEqual({ kind: 'number', n: 100_000 });
  });

  it('never asks the same one twice in a row', () => {
    for (const kind of ['number', 'year', 'age', 'phone'] as const) {
      let q = randomQuestion(kind, 'pl');
      for (let i = 0; i < 200; i++) {
        const next = randomQuestion(kind, 'pl', q);
        expect(questionKey(next)).not.toBe(questionKey(q));
        q = next;
      }
    }
  });

  it('makes each language’s phone numbers in its own formats', () => {
    for (const l of TOOL_LANGUAGES) {
      const q = randomQuestion('phone', l);
      expect(q.kind).toBe('phone');
      const written = (q as { written: string }).written;
      expect(PHONE_FORMATS[l as 'th'].some((f) => f.length === written.length && [...f].every((ch, i) => (ch === 'X' ? /\d/.test(written[i]) : ch === written[i])))).toBe(true);
    }
  });
});

describe('reading a phone number', () => {
  it('splits it into its written groups', () => {
    expect(phoneGroups('8 912 345-67-89')).toEqual(['8', '912', '345', '67', '89']);
    expect(phoneGroups('090-1234-5678')).toEqual(['090', '1234', '5678']);
    expect(fillPhone('06 XX', sequence(0.42, 0.17))).toBe('06 41');
  });

  it('reads digit by digit, or a group as a number with its leading zeros one by one', () => {
    expect(digitByDigit(['06', '42'], String)).toBe('0 6, 4 2');
    expect(groupAsNumber('05', 'zero', String)).toBe('zero 5');
    expect(groupAsNumber('045', 'zero', String)).toBe('zero 45');
    expect(groupAsNumber('00', 'zero', String)).toBe('zero zero');
    expect(groupAsNumber('512', 'zero', String)).toBe('512');
  });
});
