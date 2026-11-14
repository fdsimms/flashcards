import type { MoneySaying } from '../money';
import { distinct, type Phrase } from '../phrase';
import { countForm, russianCardinal } from './numbers';
import { russianTranslit } from './translit';

/**
 * An amount of rubles in Russian. The noun agrees with the number before it: один рубль, два
 * рубля, пять рублей (and одиннадцать рублей); тысяча is feminine (две тысячи, двадцать одна
 * тысяча), as is копейка (одна копейка, две копейки). Written as a price tag: 1 277 ₽, 12,50 ₽,
 * with a narrow space between thousands.
 */

const NARROW_SPACE = ' ';
const TILL = 'As said at a checkout';

/** A phrase, romanized when it has Cyrillic in it (a price tag's digits don't). */
function ru(text: string, note?: string): Phrase {
  return { text, ...(/[а-яё]/i.test(text) ? { roman: russianTranslit(text) } : {}), ...(note ? { note } : {}) };
}

const rubles = (n: number, one = russianCardinal(n)) => `${one} ${countForm(n, 'рубль', 'рубля', 'рублей')}`;
const kopecks = (n: number) => `${russianCardinal(n, 'f')} ${countForm(n, 'копейка', 'копейки', 'копеек')}`;

/** Digits with a narrow space between thousands: 1 277. */
function digits(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, NARROW_SPACE);
}

/** `amount` in kopecks. */
export function sayRussianMoney(amount: number): MoneySaying {
  if (!Number.isInteger(amount) || amount < 0 || amount > 99_999_999) throw new RangeError(`Not an amount: ${amount}`);
  const r = Math.floor(amount / 100);
  const k = amount % 100;
  const also: Phrase[] = [];
  let everyday: string;
  if (!k) everyday = rubles(r);
  else if (!r) everyday = kopecks(k);
  else {
    everyday = `${rubles(r)} ${kopecks(k)}`;
    also.push(ru(`${russianCardinal(r)} ${russianCardinal(k)}`, TILL));
  }
  // 1000 to 1999: тысяча, or одна тысяча as when counting out.
  if (r >= 1000 && r < 2000) also.unshift(ru(everyday.replace(/^тысяча/, 'одна тысяча')));
  const written = k ? `${digits(r)},${String(k).padStart(2, '0')}${NARROW_SPACE}₽` : `${digits(r)}${NARROW_SPACE}₽`;
  return { everyday: ru(everyday), also: distinct([ru(everyday), ...also]).slice(1), written: ru(written) };
}
