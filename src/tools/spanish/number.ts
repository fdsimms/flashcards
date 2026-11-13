import { digitByDigit, groupAsNumber, phoneGroups, type NumberQuestion, type NumberSaying } from '../number';
import type { Phrase } from '../phrase';
import { spanishCount, spanishNumber } from './numbers';

/*
 * A number in Spanish, as said in Mexico. A phone number is read in pairs (55 12 34 56 78:
 * cincuenta y cinco, doce, treinta y cuatro...), a pair starting with 0 as cero and the digit;
 * digit by digit is heard too. A year is a plain number (mil novecientos ochenta y siete). An age
 * is tengo and the number of años, uno cut to un before it: tengo veintiún años.
 */

const say = (text: string, note?: string): Phrase => ({ text, ...(note ? { note } : {}) });

/** A phone number's groups split into the pairs it's read in. */
const pairs = (groups: string[]) => groups.flatMap((g) => g.match(/\d{1,2}/g)!);

export function saySpanishNumber(q: NumberQuestion): NumberSaying {
  switch (q.kind) {
    case 'number': return { everyday: say(spanishNumber(q.n)), also: [] };
    case 'phone': {
      const groups = phoneGroups(q.written);
      return {
        everyday: say(pairs(groups).map((p) => groupAsNumber(p, 'cero', spanishNumber)).join(', ')),
        also: [say(digitByDigit(groups, spanishNumber), 'Digit by digit')],
      };
    }
    case 'year': return { everyday: say(spanishNumber(q.n)), also: [] };
    case 'age': return { everyday: say(`tengo ${spanishCount(q.n)} años`), also: [] };
  }
}
