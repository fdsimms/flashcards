import { countEnding, type CountingLanguage } from '../counting';
import type { Phrase } from '../phrase';
import { polishCardinal, polishCountForm } from './numbers';

/*
 * Counting things in Polish: after 1 the noun is singular (jeden kot, jedna książka, jedno
 * jabłko); after 2, 3 and 4, and numbers ending in them but not 12 to 14, it's the nominative
 * plural (dwa koty, dwadzieścia trzy koty); after the rest, 21 and 25 included, the genitive plural
 * (pięć kotów, dwadzieścia jeden kotów). Two agrees with a feminine noun: dwie książki. No nouns
 * for men here: they count differently again (dwóch studentów).
 */

type Gender = 'm' | 'f' | 'n';

const NOUNS: { forms: [one: string, few: string, many: string]; gender: Gender; meaning: string }[] = [
  { forms: ['kot', 'koty', 'kotów'], gender: 'm', meaning: 'cat' },
  { forms: ['pies', 'psy', 'psów'], gender: 'm', meaning: 'dog' },
  { forms: ['stół', 'stoły', 'stołów'], gender: 'm', meaning: 'table' },
  { forms: ['dom', 'domy', 'domów'], gender: 'm', meaning: 'house' },
  { forms: ['samochód', 'samochody', 'samochodów'], gender: 'm', meaning: 'car' },
  { forms: ['książka', 'książki', 'książek'], gender: 'f', meaning: 'book' },
  { forms: ['kawa', 'kawy', 'kaw'], gender: 'f', meaning: 'coffee' },
  { forms: ['butelka', 'butelki', 'butelek'], gender: 'f', meaning: 'bottle' },
  { forms: ['koszula', 'koszule', 'koszul'], gender: 'f', meaning: 'shirt' },
  { forms: ['jabłko', 'jabłka', 'jabłek'], gender: 'n', meaning: 'apple' },
  { forms: ['okno', 'okna', 'okien'], gender: 'n', meaning: 'window' },
  { forms: ['krzesło', 'krzesła', 'krzeseł'], gender: 'n', meaning: 'chair' },
];

/** `n` agreeing with `gender`: 1 jeden, jedna, jedno; a last 2 dwie for a feminine noun. */
function number(n: number, gender: Gender): string {
  if (n === 1) return { m: 'jeden', f: 'jedna', n: 'jedno' }[gender];
  const words = polishCardinal(n);
  return gender === 'f' ? words.replace(/\bdwa$/, 'dwie') : words;
}

const pl = (text: string, note?: string): Phrase => ({ text, ...(note ? { note } : {}) });

export const POLISH_COUNTING: CountingLanguage = {
  nouns: NOUNS.map((x) => ({ cue: pl(x.forms[0]), meaning: x.meaning })),
  say: (noun, n) => {
    const { forms, gender } = NOUNS[noun];
    return { everyday: pl(`${number(n, gender)} ${polishCountForm(n, ...forms)}`), also: [] };
  },
  wrong: (noun, n) => {
    const { forms, gender } = NOUNS[noun];
    const genders: Gender[] = n === 1 || n % 10 === 2 ? ['m', 'f', 'n'] : [gender];
    return genders.flatMap((g) => forms.map((f) => pl(`${number(n, g)} ${f}`)));
  },
  rule: (noun, n) => {
    const { forms, gender } = NOUNS[noun];
    const ending = countEnding(n);
    if (n === 1) return `After 1 the noun is singular, and one agrees with it: jeden ${NOUNS[0].forms[0]}, jedna ${NOUNS[5].forms[0]}, jedno ${NOUNS[9].forms[0]}.`;
    if (ending === '2-4') {
      return `After 2, 3 and 4 (and 22, 23, 24...) the noun is in the nominative plural: ${number(n, gender)} ${forms[1]}.${gender === 'f' && n % 10 === 2 ? ' Two is dwie with a feminine noun.' : ''}`;
    }
    return `After 5 and up, 11 to 14, and 21, 31... the noun is in the genitive plural: ${number(n, gender)} ${forms[2]}.`;
  },
  patterns: (noun, n) => [`ending:${n === 1 ? 'one' : countEnding(n)}`, `gender:${NOUNS[noun].gender}`],
};
