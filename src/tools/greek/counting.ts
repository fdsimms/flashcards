import type { CountingLanguage } from '../counting';
import type { Phrase } from '../phrase';
import { greekCardinal, greekNumber } from './numbers';
import { greekRoman } from './translit';

/*
 * Counting things in Greek: the number, then the noun in the plural (one takes the singular).
 * One, three and four agree with the noun, in 13, 14, 21, 23... too: ένας καφές, μία γάτα, ένα
 * βιβλίο; τρεις γάτες but τρία βιβλία; τέσσερις καφέδες but τέσσερα σπίτια. The other numbers don't change.
 */

type Gender = 'm' | 'f' | 'n';
const ARTICLE: Record<Gender, string> = { m: 'ο', f: 'η', n: 'το' };

const NOUNS: { one: string; many: string; gender: Gender; meaning: string; traps: string[] }[] = [
  { one: 'καφές', many: 'καφέδες', gender: 'm', meaning: 'coffee', traps: ['καφέες', 'καφέ'] },
  { one: 'σκύλος', many: 'σκύλοι', gender: 'm', meaning: 'dog', traps: ['σκύλους', 'σκύλα'] },
  { one: 'υπολογιστής', many: 'υπολογιστές', gender: 'm', meaning: 'computer', traps: ['υπολογιστοί', 'υπολογιστή'] },
  { one: 'φίλος', many: 'φίλοι', gender: 'm', meaning: 'friend', traps: ['φίλους', 'φίλα'] },
  { one: 'γάτα', many: 'γάτες', gender: 'f', meaning: 'cat', traps: ['γάτας', 'γάτοι'] },
  { one: 'καρέκλα', many: 'καρέκλες', gender: 'f', meaning: 'chair', traps: ['καρέκλας', 'καρέκλοι'] },
  { one: 'μπίρα', many: 'μπίρες', gender: 'f', meaning: 'beer', traps: ['μπίρας', 'μπίρα'] },
  { one: 'μέρα', many: 'μέρες', gender: 'f', meaning: 'day', traps: ['μέρας', 'μέροι'] },
  { one: 'βιβλίο', many: 'βιβλία', gender: 'n', meaning: 'book', traps: ['βιβλίοι', 'βιβλίου'] },
  { one: 'σπίτι', many: 'σπίτια', gender: 'n', meaning: 'house', traps: ['σπίτες', 'σπιτιού'] },
  { one: 'αυτοκίνητο', many: 'αυτοκίνητα', gender: 'n', meaning: 'car', traps: ['αυτοκίνητοι', 'αυτοκινήτου'] },
  { one: 'παιδί', many: 'παιδιά', gender: 'n', meaning: 'child', traps: ['παιδές', 'παιδιού'] },
];

/** `n` (1 to 100) agreeing with `gender`: ένας, μία, ένα; τρεις, τρία; τέσσερις, τέσσερα. */
function number(n: number, gender: Gender): string {
  if (n === 100) return greekCardinal(n);
  if (gender === 'n') return greekNumber(n, 'neuter');
  const words = greekNumber(n, 'feminine');
  return gender === 'm' ? words.replace(/μία$/, 'ένας') : words;
}

const el = (text: string, note?: string): Phrase => ({ text, roman: greekRoman(text), ...(note ? { note } : {}) });
/** Whether the number's form changes with the noun's gender: it ends in 1, 3 or 4, but isn't 11. */
const agrees = (n: number) => n !== 11 && [1, 3, 4].includes(n % 10) && n !== 100;

export const GREEK_COUNTING: CountingLanguage = {
  nouns: NOUNS.map((x) => ({ cue: el(`${ARTICLE[x.gender]} ${x.one}`), meaning: x.meaning })),
  say: (noun, n) => {
    const x = NOUNS[noun];
    return { everyday: el(`${number(n, x.gender)} ${n === 1 ? x.one : x.many}`), also: [] };
  },
  wrong: (noun, n) => {
    const x = NOUNS[noun];
    const forms = n === 1 ? [x.one, x.many] : [x.many, x.one, ...x.traps];
    const genders: Gender[] = agrees(n) ? ['m', 'f', 'n'] : [x.gender];
    return genders.flatMap((g) => forms.map((f) => el(`${number(n, g)} ${f}`)));
  },
  rule: (noun, n) => {
    const x = NOUNS[noun];
    const said = `${number(n, x.gender)} ${n === 1 ? x.one : x.many}`;
    if (agrees(n)) return `One, three and four agree with the noun's gender, in 13, 14, 21, 23... too: ${said}. The plural of ${x.one} is ${x.many}.`;
    return n === 1 ? undefined : `The plural of ${x.one} is ${x.many}.`;
  },
  patterns: (noun, n) => [`noun:${noun}`, `agrees:${agrees(n)}`],
};
