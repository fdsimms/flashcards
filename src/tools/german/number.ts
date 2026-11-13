import { digitByDigit, phoneGroups, type NumberQuestion, type NumberSaying } from '../number';
import { distinct, type Phrase } from '../phrase';
import { germanCardinal, germanNumber, germanYear } from './numbers';

/*
 * A number in German, one word: tausendzweihundertsiebenundsiebzig, with einhundert and eintausend
 * heard as much at the start. A phone number is read digit by digit, a pause after the prefix,
 * and 2 is often zwo, so it isn't heard as drei. A year before 2000 is in hundreds
 * (neunzehnhundertsiebenundachtzig). An age is ich bin and the number, or with Jahre alt.
 */

const say = (text: string, note?: string): Phrase => ({ text, ...(note ? { note } : {}) });

/** With ein before a leading hundert or tausend, and before the hundert after tausend: eintausendeinhundert. */
const withEin = (words: string) => words.replace(/^(hundert|tausend)/, 'ein$1').replace(/tausendhundert/, 'tausendeinhundert');

export function sayGermanNumber(q: NumberQuestion): NumberSaying {
  switch (q.kind) {
    case 'number': {
      const everyday = say(germanCardinal(q.n));
      return { everyday, also: distinct([everyday, say(withEin(everyday.text), 'With ein, as often said')]).slice(1) };
    }
    case 'phone': {
      const groups = phoneGroups(q.written);
      const everyday = say(digitByDigit(groups, germanNumber));
      return { everyday, also: distinct([everyday, say(digitByDigit(groups, (d) => (d === 2 ? 'zwo' : germanNumber(d))), 'Zwo for 2, so it isn\'t heard as drei')]).slice(1) };
    }
    case 'year': return { everyday: say(germanYear(q.n)), also: [] };
    case 'age': return { everyday: say(`ich bin ${germanCardinal(q.n)}`), also: [say(`ich bin ${germanCardinal(q.n)} Jahre alt`)] };
  }
}
