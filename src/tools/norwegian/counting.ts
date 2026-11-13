import type { CountingLanguage } from '../counting';
import type { Phrase } from '../phrase';
import { norwegianCardinal } from './numbers';

/*
 * Counting things in Norwegian (Bokmål): the number, then the indefinite plural, which mostly
 * adds -er (tre hunder, to biler) but not always: tre bøker, to menn, and a short et noun stays
 * as it is (tre hus, to barn). One is én with an en noun and ett with an et noun: én hund, ett hus.
 */

type Gender = 'en' | 'et';
const ONE: Record<Gender, string> = { en: 'én', et: 'ett' };

const NOUNS: { one: string; many: string; gender: Gender; meaning: string; traps: string[] }[] = [
  { one: 'hund', many: 'hunder', gender: 'en', meaning: 'dog', traps: ['hunde', 'hundar', 'hundene'] },
  { one: 'bok', many: 'bøker', gender: 'en', meaning: 'book', traps: ['boker', 'bøkene', 'boks'] },
  { one: 'stol', many: 'stoler', gender: 'en', meaning: 'chair', traps: ['stole', 'stolar', 'stolene'] },
  { one: 'bil', many: 'biler', gender: 'en', meaning: 'car', traps: ['bile', 'bilar', 'bilene'] },
  { one: 'kopp', many: 'kopper', gender: 'en', meaning: 'cup', traps: ['koppe', 'koppar', 'koppene'] },
  { one: 'mann', many: 'menn', gender: 'en', meaning: 'man', traps: ['manner', 'menner', 'mennene'] },
  { one: 'flaske', many: 'flasker', gender: 'en', meaning: 'bottle', traps: ['flasken', 'flaskar', 'flaskene'] },
  { one: 'hus', many: 'hus', gender: 'et', meaning: 'house', traps: ['huser', 'huse', 'husene'] },
  { one: 'barn', many: 'barn', gender: 'et', meaning: 'child', traps: ['barner', 'barne', 'barna'] },
  { one: 'eple', many: 'epler', gender: 'et', meaning: 'apple', traps: ['eplene', 'epla', 'eples'] },
  { one: 'glass', many: 'glass', gender: 'et', meaning: 'glass', traps: ['glasser', 'glasse', 'glassene'] },
  { one: 'bord', many: 'bord', gender: 'et', meaning: 'table', traps: ['border', 'borde', 'bordene'] },
];

const nb = (text: string): Phrase => ({ text });

export const NORWEGIAN_COUNTING: CountingLanguage = {
  nouns: NOUNS.map((x) => ({ cue: nb(`${x.gender} ${x.one}`), meaning: x.meaning })),
  say: (noun, n) => {
    const x = NOUNS[noun];
    return { everyday: nb(n === 1 ? `${ONE[x.gender]} ${x.one}` : `${norwegianCardinal(n)} ${x.many}`), also: [] };
  },
  wrong: (noun, n) => {
    const x = NOUNS[noun];
    if (n === 1) return [`${x.gender === 'en' ? 'ett' : 'én'} ${x.one}`, ...[x.many, ...x.traps].map((f) => `${ONE[x.gender]} ${f}`)].map(nb);
    return [x.one, ...x.traps].map((f) => nb(`${norwegianCardinal(n)} ${f}`));
  },
  rule: (noun, n) => {
    const x = NOUNS[noun];
    if (n === 1) return `One is én with an en noun and ett with an et noun: ${ONE[x.gender]} ${x.one}.`;
    return x.many === x.one ? `${x.gender} ${x.one} stays the same in the plural: ${norwegianCardinal(n)} ${x.many}.` : `${x.gender} ${x.one}, plural ${x.many}.`;
  },
  patterns: (noun) => [`noun:${noun}`],
};
