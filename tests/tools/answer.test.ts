import { describe, expect, it } from 'vitest';
import { checkTyped } from '../../src/tools/answer';
import { sayThaiDate } from '../../src/tools/thai/date';
import { acceptedForms } from '../../src/tools/dateQuiz';
import { saySpanishDate } from '../../src/tools/spanish/date';
import { sayJapaneseDate } from '../../src/tools/japanese/date';

const monday = { year: 2044, month: 6, day: 27 };
const thai = acceptedForms(sayThaiDate(monday, { weekday: true, year: true }));
const right = 'วันจันทร์ที่ยี่สิบเจ็ด มิถุนายน พ.ศ. สองพันห้าร้อยแปดสิบเจ็ด';
const marked = (segments: { text: string; marked: boolean }[]) => segments.filter((s) => s.marked).map((s) => s.text);

describe('checking a typed answer', () => {
  it('accepts the answer as is', () => {
    const c = checkTyped(right, thai);
    expect(c.verdict).toBe('exact');
    expect(c.expected.text).toBe(right);
    expect(marked(c.typed)).toEqual([]);
  });

  it('ignores spaces, punctuation and case, since Thai is written without word spaces', () => {
    expect(checkTyped(right.replace(/ /g, ''), thai).verdict).toBe('exact');
    expect(checkTyped('  วันจันทร์ที่ยี่สิบเจ็ด   มิถุนายน พศ สองพันห้าร้อยแปดสิบเจ็ด ', thai).verdict).toBe('exact');
    expect(checkTyped('LUNES 27 DE JUNIO'.toLowerCase(), acceptedForms(saySpanishDate(monday, { weekday: true, year: false }))).verdict).toBe('exact');
  });

  it('takes a final sigma typed in capitals, and ss for ß', () => {
    expect(checkTyped('ΤΡΕΙΣ ΝΟΕΜΒΡΙΟΥ', [{ text: 'τρεις Νοεμβρίου' }]).verdict).toBe('close');
    expect(checkTyped('ΤΡΕΙΣ ΝΟΕΜΒΡΊΟΥ', [{ text: 'τρεις Νοεμβρίου' }]).verdict).toBe('exact');
    expect(checkTyped('einunddreissigste', [{ text: 'einunddreißigste' }]).verdict).toBe('exact');
  });

  it('takes a Japanese date written with digits, the weekday in parentheses or written out, digits full-width or not', () => {
    const ja = acceptedForms(sayJapaneseDate({ year: 2026, month: 11, day: 13 }, { weekday: true, year: true }));
    for (const typed of ['2026年11月13日（金）', '2026年11月13日金曜日', '2026年11月13日金曜', '２０２６年１１月１３日（金）']) {
      expect(checkTyped(typed, ja).verdict).toBe('exact');
    }
    expect(checkTyped('2026年11月14日金曜日', ja).verdict).toBe('different');
  });

  it('takes е for ё as Russian writes it, and marks only what else differs', () => {
    expect(checkTyped('четвертое', [{ text: 'четвёртое' }]).verdict).toBe('exact');
    expect(checkTyped('ЧЕТВЁРТОЕ', [{ text: 'четвертое' }]).verdict).toBe('exact');
    const c = checkTyped('четвертыи', [{ text: 'четвёртый' }]);
    expect(c.verdict).toBe('close');
    expect(marked(c.correct)).toEqual(['й']);
  });

  it('calls ø, æ, œ and ł typed without the mark close, like a missing accent', () => {
    const c = checkTyped('tolv kroner og nitti ore', [{ text: 'tolv kroner og nitti øre' }]);
    expect(c.verdict).toBe('close');
    expect(marked(c.correct)).toEqual(['ø']);
    expect(checkTyped('aerlig', [{ text: 'ærlig' }]).verdict).toBe('close');
    expect(checkTyped('arlig', [{ text: 'ærlig' }]).verdict).toBe('different');
    expect(checkTyped('soeur', [{ text: 'sœur' }]).verdict).toBe('close');
    expect(checkTyped('dwa zlote', [{ text: 'dwa złote' }]).verdict).toBe('close');
  });

  it('accepts the other forms of the date: shortened, without the era, in digits', () => {
    const checked = (s: string) => checkTyped(s, thai);
    expect(checked('วันจันทร์ที่ยี่สิบเจ็ด มิถุนา พ.ศ. สองพันห้าร้อยแปดสิบเจ็ด').verdict).toBe('exact');
    expect(checked('วันจันทร์ที่ยี่สิบเจ็ด มิถุนายน สองพันห้าร้อยแปดสิบเจ็ด').verdict).toBe('exact');
    expect(checked('วันจันทร์ที่ 27 มิถุนายน พ.ศ. 2587').verdict).toBe('exact');
  });

  it('calls a wrong mark close, and marks the letters on both sides', () => {
    const c = checkTyped('วันจันทรที่ยี่สิบเจ็ด มีถุนายน พ.ศ. สองพันห้าร้อยแปดสิบเจ็ด', thai);
    expect(c.verdict).toBe('close');
    expect(c.expected.text).toBe(right);
    expect(marked(c.typed)).toEqual(['ร', 'มี']);
    expect(marked(c.correct)).toEqual(['ร์', 'มิ']);
    expect(c.differing).toBe(2);
  });

  it('calls a wrong accent close in the other scripts too', () => {
    const es = acceptedForms(saySpanishDate({ year: 2026, month: 11, day: 12 }, { weekday: true, year: false }));
    const c = checkTyped('jueves doce de noviembré', es);
    expect(c.verdict).toBe('close');
    expect(marked(c.correct)).toEqual(['e']);
  });

  it('calls another letter or word different, and marks it against the usual form', () => {
    const c = checkTyped('วันจันทร์ที่ยี่สิบเจ็ด มีนาคม พ.ศ. สองพันห้าร้อยแปดสิบเจ็ด', thai);
    expect(c.verdict).toBe('different');
    expect(c.expected.text).toBe(right);
    expect(marked(c.correct).join('')).toContain('ถุ');
    expect(marked(c.typed).length).toBeGreaterThan(0);
  });

  it('marks what was left out and what was added', () => {
    const left = checkTyped('วันจันทร์ที่ยี่สิบเจ็ด มิถุนายน', thai);
    expect(left.verdict).toBe('different');
    expect(marked(left.typed)).toEqual([]);
    expect(marked(left.correct).join('')).not.toBe('');
    const extra = checkTyped(right + 'ก', thai);
    expect(marked(extra.typed)).toEqual(['ก']);
  });

  it('says different, with nothing marked, for an empty answer', () => {
    const c = checkTyped('  ', thai);
    expect(c.verdict).toBe('different');
    expect(c.typed).toEqual([]);
    expect(c.expected.text).toBe(right);
  });

  it('needs something to check against', () => {
    expect(() => checkTyped('x', [])).toThrow(RangeError);
  });
});
