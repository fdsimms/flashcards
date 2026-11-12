import type { MoneySaying } from '../money';
import { distinct, type Phrase } from '../phrase';
import { germanCardinal, germanCardinalBeforeNoun } from './numbers';

/**
 * An amount of euros in German. Euro and Cent don't take a plural: "tausendzweihundertsiebenundsiebzig
 * Euro", "ein Euro", "fünfzig Cent". With cents, the cents follow the euros on their own, as a price
 * is read out ("zwölf Euro fünfzig"), or in full ("zwölf Euro und fünfzig Cent"). Between 1,000 and
 * 1,999, and 100 and 199, eintausend and einhundert are heard too. Written: "1.277,50 €", "12 €".
 */

const NBSP = ' ';
const say = (text: string, note?: string): Phrase => ({ text, ...(note ? { note } : {}) });

/** Digits with a dot between thousands, as German writes them. */
function digits(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function sayGermanMoney(amount: number): MoneySaying {
  if (!Number.isInteger(amount) || amount < 1 || amount > 99_999_999) throw new RangeError(`Not an amount: ${amount}`);
  const euros = Math.floor(amount / 100);
  const cents = amount % 100;
  const euroWords = (withEin: boolean) => {
    const w = germanCardinalBeforeNoun(euros);
    if (!withEin) return w;
    return w.replace(/^tausend/, 'eintausend').replace(/^hundert/, 'einhundert');
  };
  const forms = (withEin: boolean): Phrase[] => {
    const e = euroWords(withEin);
    if (!euros) return [say(`${germanCardinalBeforeNoun(cents)} Cent`)];
    if (!cents) return [say(`${e} Euro`)];
    return [say(`${e} Euro ${germanCardinal(cents)}`), say(`${e} Euro und ${germanCardinalBeforeNoun(cents)} Cent`)];
  };
  const [everyday, ...rest] = forms(false);
  const written = cents ? `${digits(euros)},${String(cents).padStart(2, '0')}${NBSP}€` : `${digits(euros)}${NBSP}€`;
  return { everyday, also: distinct([everyday, ...rest, ...forms(true)]).slice(1), written: say(written) };
}
