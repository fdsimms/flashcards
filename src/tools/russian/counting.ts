import { countEnding, type CountingLanguage } from '../counting';
import type { Phrase } from '../phrase';
import { countForm, russianCardinal } from './numbers';
import { russianTranslit } from './translit';

/*
 * Counting things in Russian: after 1, 21, 31... the noun is in the nominative singular (один кот,
 * двадцать один кот); after 2, 3 and 4, and numbers ending in them but not 12 to 14, the genitive
 * singular (два кота); after the rest, the genitive plural (пять котов). One and two agree with
 * the noun: одна книга, одно яблоко, две книги.
 */

type Gender = 'm' | 'f' | 'n';

const NOUNS: { forms: [one: string, few: string, many: string]; gender: Gender; meaning: string }[] = [
  { forms: ['кот', 'кота', 'котов'], gender: 'm', meaning: 'cat' },
  { forms: ['стол', 'стола', 'столов'], gender: 'm', meaning: 'table' },
  { forms: ['дом', 'дома', 'домов'], gender: 'm', meaning: 'house' },
  { forms: ['билет', 'билета', 'билетов'], gender: 'm', meaning: 'ticket' },
  { forms: ['стул', 'стула', 'стульев'], gender: 'm', meaning: 'chair' },
  { forms: ['книга', 'книги', 'книг'], gender: 'f', meaning: 'book' },
  { forms: ['машина', 'машины', 'машин'], gender: 'f', meaning: 'car' },
  { forms: ['чашка', 'чашки', 'чашек'], gender: 'f', meaning: 'cup' },
  { forms: ['бутылка', 'бутылки', 'бутылок'], gender: 'f', meaning: 'bottle' },
  { forms: ['яблоко', 'яблока', 'яблок'], gender: 'n', meaning: 'apple' },
  { forms: ['окно', 'окна', 'окон'], gender: 'n', meaning: 'window' },
  { forms: ['письмо', 'письма', 'писем'], gender: 'n', meaning: 'letter' },
];

/** `n` agreeing with `gender`: a last 1 один, одна, одно; a last 2 два, две. */
function number(n: number, gender: Gender): string {
  const words = russianCardinal(n, gender === 'f' ? 'f' : 'm');
  return gender === 'n' ? words.replace(/один$/, 'одно') : words;
}

const ru = (text: string, note?: string): Phrase => ({ text, roman: russianTranslit(text), ...(note ? { note } : {}) });

export const RUSSIAN_COUNTING: CountingLanguage = {
  nouns: NOUNS.map((x) => ({ cue: ru(x.forms[0]), meaning: x.meaning })),
  say: (noun, n) => {
    const { forms, gender } = NOUNS[noun];
    return { everyday: ru(`${number(n, gender)} ${countForm(n, ...forms)}`), also: [] };
  },
  wrong: (noun, n) => {
    const { forms, gender } = NOUNS[noun];
    const last = n % 10;
    const genders: Gender[] = last === 1 || last === 2 ? ['m', 'f', 'n'] : [gender];
    return genders.flatMap((g) => forms.map((f) => ru(`${number(n, g)} ${f}`)));
  },
  rule: (noun, n) => {
    const { forms, gender } = NOUNS[noun];
    const ending = countEnding(n);
    if (ending === '1') return `After 1, 21, 31... the noun is in the nominative singular, and one agrees with it: ${number(n, gender)} ${forms[0]}.`;
    if (ending === '2-4') return `After 2, 3 and 4 (and 22, 23, 24...) the noun is in the genitive singular: ${number(n, gender)} ${forms[1]}.${gender === 'f' && n % 10 === 2 ? ' Two is две with a feminine noun.' : ''}`;
    return `After 5 to 20, and 25 to 30..., the noun is in the genitive plural: ${number(n, gender)} ${forms[2]}.`;
  },
  patterns: (noun, n) => [`ending:${countEnding(n)}`, `gender:${NOUNS[noun].gender}`],
};
