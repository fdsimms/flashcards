import { digitByDigit, groupAsNumber, phoneGroups, type NumberQuestion, type NumberSaying } from '../number';
import type { Phrase } from '../phrase';
import { countForm, russianCardinal, russianNumber, yearOrdinal } from './numbers';
import { russianTranslit } from './translit';

/*
 * A number in Russian, with a romanization. A phone number is read in its groups (8 912 345-67-89:
 * восемь, девятьсот двенадцать, триста сорок пять, шестьдесят семь, восемьдесят девять); digit
 * by digit is heard too. A year is an ordinal (год is understood): тысяча девятьсот восемьдесят
 * седьмой, and in 1987 is в тысяча девятьсот восемьдесят седьмом году. An age is мне, the number,
 * and год, года or лет.
 */

const say = (text: string, note?: string): Phrase => ({ text, roman: russianTranslit(text), ...(note ? { note } : {}) });

export function sayRussianNumber(q: NumberQuestion): NumberSaying {
  switch (q.kind) {
    case 'number': return { everyday: say(russianCardinal(q.n)), also: [] };
    case 'phone': {
      const groups = phoneGroups(q.written);
      return {
        everyday: say(groups.map((g) => groupAsNumber(g, 'ноль', russianCardinal)).join(', ')),
        also: [say(digitByDigit(groups, (d) => russianNumber(d)), 'Digit by digit')],
      };
    }
    case 'year': return {
      everyday: say(yearOrdinal(q.n, 'nominative')),
      also: [say(`в ${yearOrdinal(q.n, 'prepositional')} году`, `In ${q.n}`)],
    };
    case 'age': return { everyday: say(`мне ${russianCardinal(q.n)} ${countForm(q.n, 'год', 'года', 'лет')}`), also: [] };
  }
}
