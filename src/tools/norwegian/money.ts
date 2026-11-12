import type { MoneySaying } from '../money';
import { distinct, type Phrase } from '../phrase';
import { norwegianCardinal } from './numbers';

/**
 * An amount of Norwegian kroner, read out: "tusen to hundre og syttisju kroner", "én krone",
 * "tjueen kroner". Prices are in whole kroner (no øre coins are left), but an amount with øre is
 * said "tolv kroner og femti øre", or "tolv femti" at a till. Between 1,000 and 1,999, and 100 and
 * 199, "ett tusen" and "ett hundre" are heard too. Written: "1 277 kr", "12,50 kr".
 */

const NBSP = ' ';
const say = (text: string, note?: string): Phrase => ({ text, ...(note ? { note } : {}) });

/** Digits with a space between thousands, as Norwegian writes them. */
function digits(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

export function sayNorwegianMoney(amount: number): MoneySaying {
  if (!Number.isInteger(amount) || amount < 1 || amount > 99_999_999) throw new RangeError(`Not an amount: ${amount}`);
  const kroner = Math.floor(amount / 100);
  const ore = amount % 100;
  const krone = (words: string) => (kroner === 1 ? 'én krone' : `${words} kroner`);
  const oreWords = ore === 1 ? 'ett øre' : `${norwegianCardinal(ore)} øre`;
  const said = (words: string): Phrase[] => {
    if (!kroner) return [say(oreWords)];
    if (!ore) return [say(krone(words))];
    return [say(`${krone(words)} og ${oreWords}`), say(`${kroner === 1 ? 'en' : words} ${norwegianCardinal(ore)}`, 'Shorter, as at a till')];
  };
  const plain = norwegianCardinal(kroner);
  const withEtt = plain.replace(/^tusen/, 'ett tusen').replace(/^hundre/, 'ett hundre');
  const [everyday, ...rest] = said(plain);
  const written = ore ? `${digits(kroner)},${String(ore).padStart(2, '0')}${NBSP}kr` : `${digits(kroner)}${NBSP}kr`;
  return { everyday, also: distinct([everyday, ...rest, ...(kroner ? said(withEtt) : [])]).slice(1), written: say(written) };
}
