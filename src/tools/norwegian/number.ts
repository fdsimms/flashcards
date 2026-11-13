import { digitByDigit, phoneGroups, type NumberQuestion, type NumberSaying } from '../number';
import { distinct, type Phrase } from '../phrase';
import { norwegianYear, shortYear } from './date';
import { norwegianCardinal, norwegianNumber } from './numbers';

/*
 * A number in Norwegian (Bokmål): tusen to hundre og syttisju, with ett tusen and ett hundre heard
 * too at the start. A phone number is read digit by digit, a pause between its groups. A year is
 * one word (nittenhundreogåttisju), shortened in speech (nittenåttisju). An age is jeg er, the
 * number and år, or the number alone.
 */

const say = (text: string, note?: string): Phrase => ({ text, ...(note ? { note } : {}) });

export function sayNorwegianNumber(q: NumberQuestion): NumberSaying {
  switch (q.kind) {
    case 'number': {
      const everyday = say(norwegianCardinal(q.n));
      const withEtt = everyday.text.replace(/^tusen/, 'ett tusen').replace(/^hundre/, 'ett hundre');
      return { everyday, also: distinct([everyday, say(withEtt)]).slice(1) };
    }
    case 'phone': return { everyday: say(digitByDigit(phoneGroups(q.written), norwegianNumber)), also: [] };
    case 'year': {
      const short = shortYear(q.n);
      return { everyday: say(norwegianYear(q.n)), also: short ? [say(short, 'Shorter, in speech')] : [] };
    }
    case 'age': return { everyday: say(`jeg er ${norwegianNumber(q.n)} år`), also: [say(`jeg er ${norwegianNumber(q.n)}`)] };
  }
}
