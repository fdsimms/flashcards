import { digitByDigit, phoneGroups, type NumberQuestion, type NumberSaying } from '../number';
import type { Phrase } from '../phrase';
import { turkishCardinal, turkishNumber } from './numbers';

/*
 * A number in Turkish: bin iki yüz yetmiş yedi, in separate words. A phone number is read digit by
 * digit, a pause between its groups (0532 is sıfır beş üç iki); that is the one reading given, since
 * people also say it in pairs or threes and there is no single way. A year is a plain number, not an
 * ordinal (bin dokuz yüz seksen yedi). An age is the number and yaşındayım, the same for every number
 * (yaş and the endings on it don't change with the number before it), with ben heard too.
 */

const say = (text: string, note?: string): Phrase => ({ text, ...(note ? { note } : {}) });

export function sayTurkishNumber(q: NumberQuestion): NumberSaying {
  switch (q.kind) {
    case 'number': return { everyday: say(turkishCardinal(q.n)), also: [] };
    case 'phone': return { everyday: say(digitByDigit(phoneGroups(q.written), turkishNumber)), also: [] };
    case 'year': return { everyday: say(turkishCardinal(q.n)), also: [] };
    case 'age': return { everyday: say(`${turkishCardinal(q.n)} yaşındayım`), also: [say(`ben ${turkishCardinal(q.n)} yaşındayım`)] };
  }
}
