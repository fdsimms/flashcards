import type { CountingLanguage } from '../counting';
import type { Phrase } from '../phrase';
import { germanCardinal } from './numbers';

/*
 * Counting things in German: the number, then the plural, which has to be known (drei Hunde,
 * zwei Bücher, vier Äpfel, fünf Autos). One is ein or eine, by the noun's gender, with the
 * singular: ein Hund, eine Katze, ein Buch.
 */

type Gender = 'm' | 'f' | 'n';
const ARTICLE: Record<Gender, string> = { m: 'der', f: 'die', n: 'das' };
const ONE: Record<Gender, string> = { m: 'ein', f: 'eine', n: 'ein' };

const NOUNS: { one: string; many: string; gender: Gender; meaning: string; traps: string[] }[] = [
  { one: 'Hund', many: 'Hunde', gender: 'm', meaning: 'dog', traps: ['Hunden', 'Hünde', 'Hunds'] },
  { one: 'Stuhl', many: 'Stühle', gender: 'm', meaning: 'chair', traps: ['Stuhle', 'Stühler', 'Stuhls'] },
  { one: 'Apfel', many: 'Äpfel', gender: 'm', meaning: 'apple', traps: ['Apfel', 'Apfeln', 'Äpfeln'] },
  { one: 'Tisch', many: 'Tische', gender: 'm', meaning: 'table', traps: ['Tischen', 'Tischer', 'Tischs'] },
  { one: 'Katze', many: 'Katzen', gender: 'f', meaning: 'cat', traps: ['Katzes', 'Kätze', 'Katze'] },
  { one: 'Flasche', many: 'Flaschen', gender: 'f', meaning: 'bottle', traps: ['Flasches', 'Fläsche', 'Flasche'] },
  { one: 'Stadt', many: 'Städte', gender: 'f', meaning: 'city', traps: ['Stadten', 'Städter', 'Stadte'] },
  { one: 'Nacht', many: 'Nächte', gender: 'f', meaning: 'night', traps: ['Nachten', 'Nachte', 'Nächten'] },
  { one: 'Buch', many: 'Bücher', gender: 'n', meaning: 'book', traps: ['Buche', 'Buchen', 'Bücheren'] },
  { one: 'Haus', many: 'Häuser', gender: 'n', meaning: 'house', traps: ['Hause', 'Hausen', 'Häuse'] },
  { one: 'Kind', many: 'Kinder', gender: 'n', meaning: 'child', traps: ['Kinde', 'Kinden', 'Kinds'] },
  { one: 'Auto', many: 'Autos', gender: 'n', meaning: 'car', traps: ['Auten', 'Autoen', 'Autor'] },
];

const de = (text: string): Phrase => ({ text });

export const GERMAN_COUNTING: CountingLanguage = {
  nouns: NOUNS.map((x) => ({ cue: de(`${ARTICLE[x.gender]} ${x.one}`), meaning: x.meaning })),
  say: (noun, n) => {
    const x = NOUNS[noun];
    return { everyday: de(n === 1 ? `${ONE[x.gender]} ${x.one}` : `${germanCardinal(n)} ${x.many}`), also: [] };
  },
  wrong: (noun, n) => {
    const x = NOUNS[noun];
    if (n === 1) return [`${ONE[x.gender] === 'ein' ? 'eine' : 'ein'} ${x.one}`, `${ONE[x.gender]} ${x.many}`, ...x.traps.map((t) => `${ONE[x.gender]} ${t}`)].map(de);
    return [x.one, ...x.traps].map((f) => de(`${germanCardinal(n)} ${f}`));
  },
  rule: (noun, n) => {
    const x = NOUNS[noun];
    return n === 1 ? `One is ein before der and das nouns, eine before die nouns: ${ONE[x.gender]} ${x.one}.` : `${ARTICLE[x.gender]} ${x.one}, plural die ${x.many}.`;
  },
  patterns: (noun) => [`noun:${noun}`],
};
