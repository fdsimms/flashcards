import { digitByDigit, groupAsNumber, phoneGroups, type NumberQuestion, type NumberSaying } from '../number';
import type { Phrase } from '../phrase';
import { polishCardinal, polishCountForm, polishNumber, yearOrdinal } from './numbers';

/*
 * A number in Polish. A phone number is read in its threes (512 345 678: pięćset dwanaście,
 * trzysta czterdzieści pięć, sześćset siedemdziesiąt osiem); digit by digit is heard too. A year
 * is an ordinal (rok is understood): tysiąc dziewięćset osiemdziesiąty siódmy, and in 1987 is w
 * tysiąc dziewięćset osiemdziesiątym siódmym roku. An age is mam and the number of lata or lat.
 */

const say = (text: string, note?: string): Phrase => ({ text, ...(note ? { note } : {}) });

export function sayPolishNumber(q: NumberQuestion): NumberSaying {
  switch (q.kind) {
    case 'number': return { everyday: say(polishCardinal(q.n)), also: [] };
    case 'phone': {
      const groups = phoneGroups(q.written);
      return {
        everyday: say(groups.map((g) => groupAsNumber(g, 'zero', polishCardinal)).join(', ')),
        also: [say(digitByDigit(groups, (d) => polishNumber(d)), 'Digit by digit')],
      };
    }
    case 'year': return {
      everyday: say(yearOrdinal(q.n, 'nominative')),
      also: [say(`w ${yearOrdinal(q.n, 'locative')} roku`, `In ${q.n}`)],
    };
    case 'age': return { everyday: say(`mam ${polishCardinal(q.n)} ${polishCountForm(q.n, 'rok', 'lata', 'lat')}`), also: [] };
  }
}
