import { digitByDigit, phoneGroups, type NumberQuestion, type NumberSaying } from '../number';
import { phrase, type Phrase, type Word } from '../phrase';
import { BE, buddhistYear, CE } from './date';
import { thaiNumber } from './numbers';

/*
 * A number in Thai, with a romanization. A phone number is read digit by digit, a pause between
 * its groups. A year is the Buddhist Era's (พ.ศ. 2530, as Thai writes and says it), with the
 * Christian year (ค.ศ.) heard too. An age is อายุ, the number and ปี: อายุสามสิบสี่ปี.
 */

const AAYU: Word = ['อายุ', 'aa-yú'];
const BII: Word = ['ปี', 'bpii'];

/** Phrases set apart by spaces, as Thai sets apart a year's era and its number. */
function spaced(parts: Phrase[], note?: string): Phrase {
  return { text: parts.map((p) => p.text).join(' '), roman: parts.map((p) => p.roman).join(' '), ...(note ? { note } : {}) };
}

export function sayThaiNumber(q: NumberQuestion): NumberSaying {
  switch (q.kind) {
    case 'number': return { everyday: phrase(thaiNumber(q.n), ''), also: [] };
    case 'phone': {
      const groups = phoneGroups(q.written);
      const digit = (d: number) => thaiNumber(d)[0];
      return {
        everyday: {
          text: digitByDigit(groups, (d) => digit(d)[0], '', ' '),
          roman: digitByDigit(groups, (d) => digit(d)[1], ' ', ', '),
        },
        also: [],
      };
    }
    case 'year': {
      const year = (era: Word, y: number, note?: string) => spaced([phrase([era], ''), phrase(thaiNumber(y), '')], note);
      return { everyday: year(BE, buddhistYear(q.n)), also: [year(CE, q.n, `The Christian year, ${q.n}`)] };
    }
    case 'age': return { everyday: phrase([AAYU, ...thaiNumber(q.n), BII], ''), also: [] };
  }
}
