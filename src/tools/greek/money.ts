import type { MoneySaying } from '../money';
import { distinct, type Phrase } from '../phrase';
import { greekCardinal } from './numbers';
import { greekRoman } from './translit';

/**
 * An amount of euros in Greek, the numbers neuter (το ευρώ, τα λεπτά): "χίλια διακόσια εβδομήντα
 * εφτά ευρώ", "ένα ευρώ". With cents, "δώδεκα ευρώ και πενήντα λεπτά", or at a till just "δώδεκα
 * και πενήντα"; cents alone "πενήντα λεπτά", one "ένα λεπτό". Written: "1.277,50 €".
 */

const NBSP = ' ';
const say = (text: string, note?: string): Phrase => ({ text, roman: greekRoman(text), ...(note ? { note } : {}) });

/** Digits with a dot between thousands, as Greek writes them. */
function digits(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function sayGreekMoney(amount: number): MoneySaying {
  if (!Number.isInteger(amount) || amount < 1 || amount > 99_999_999) throw new RangeError(`Not an amount: ${amount}`);
  const euros = Math.floor(amount / 100);
  const cents = amount % 100;
  const centWords = cents === 1 ? 'ένα λεπτό' : `${greekCardinal(cents)} λεπτά`;
  const forms: Phrase[] = !euros
    ? [say(centWords)]
    : !cents
      ? [say(`${greekCardinal(euros)} ευρώ`)]
      : [say(`${greekCardinal(euros)} ευρώ και ${centWords}`), say(`${greekCardinal(euros)} και ${greekCardinal(cents)}`, 'Shorter, as at a till')];
  const written = cents ? `${digits(euros)},${String(cents).padStart(2, '0')}${NBSP}€` : `${digits(euros)}${NBSP}€`;
  return { everyday: forms[0], also: distinct(forms).slice(1), written: say(written) };
}
