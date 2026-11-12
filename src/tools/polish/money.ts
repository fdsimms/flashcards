import type { MoneySaying } from '../money';
import { distinct, type Phrase } from '../phrase';
import { polishCardinal, polishCountForm } from './numbers';

/**
 * An amount of złoty in Polish. The noun agrees with the number before it: jeden złoty, dwa złote,
 * pięć złotych, dwadzieścia jeden złotych, dwadzieścia dwa złote; grosz likewise (grosz, grosze,
 * groszy). At a till the units are often left off: dwanaście pięćdziesiąt. Written as a price tag:
 * 1 277,50 zł, 12 zł, with a narrow space between thousands.
 */

const NARROW_SPACE = ' ';
const TILL = 'As said at a till';

const pl = (text: string, note?: string): Phrase => ({ text, ...(note ? { note } : {}) });
const zloty = (n: number) => `${polishCardinal(n)} ${polishCountForm(n, 'złoty', 'złote', 'złotych')}`;
const grosze = (n: number) => `${polishCardinal(n)} ${polishCountForm(n, 'grosz', 'grosze', 'groszy')}`;

/** Digits with a narrow space between thousands: 1 277. */
function digits(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, NARROW_SPACE);
}

/** `amount` in grosze. */
export function sayPolishMoney(amount: number): MoneySaying {
  if (!Number.isInteger(amount) || amount < 0 || amount > 99_999_999) throw new RangeError(`Not an amount: ${amount}`);
  const z = Math.floor(amount / 100);
  const g = amount % 100;
  const also: Phrase[] = [];
  let everyday: string;
  if (!g) everyday = zloty(z);
  else if (!z) everyday = grosze(g);
  else {
    everyday = `${zloty(z)} ${grosze(g)}`;
    also.push(pl(`${polishCardinal(z)} ${polishCardinal(g)}`, TILL));
  }
  const written = `${digits(z)}${g ? `,${String(g).padStart(2, '0')}` : ''}${NARROW_SPACE}zł`;
  return { everyday: pl(everyday), also: distinct([pl(everyday), ...also]).slice(1), written: pl(written) };
}
