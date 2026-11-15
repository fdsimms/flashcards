import type { MoneySaying } from '../money';
import { distinct, type Phrase } from '../phrase';
import { turkishCardinal } from './numbers';

/**
 * An amount of Turkish lira, read out: "bin iki yüz yetmiş yedi lira", "on iki lira elli kuruş". The
 * noun stays singular after a number (iki lira, beş kuruş). 50 kuruş is also said buçuk, a half,
 * after the lira: on iki buçuk lira. Written as a price tag: "1.277 TL", "12,50 TL", a dot between
 * thousands and a comma before the kuruş.
 */

const say = (text: string, note?: string): Phrase => ({ text, ...(note ? { note } : {}) });

/** Digits with a dot between thousands, as Turkish writes them: 1.277. */
function digits(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** `amount` in kuruş. */
export function sayTurkishMoney(amount: number): MoneySaying {
  if (!Number.isInteger(amount) || amount < 1 || amount > 99_999_999) throw new RangeError(`Not an amount: ${amount}`);
  const lira = Math.floor(amount / 100);
  const kurus = amount % 100;
  const liraWords = `${turkishCardinal(lira)} lira`;
  const kurusWords = `${turkishCardinal(kurus)} kuruş`;
  const everyday = !kurus ? liraWords : !lira ? kurusWords : `${liraWords} ${kurusWords}`;
  const half = lira && kurus === 50 ? [say(`${turkishCardinal(lira)} buçuk lira`, 'Buçuk (half) for 50 kuruş')] : [];
  const written = `${digits(lira)}${kurus ? `,${String(kurus).padStart(2, '0')}` : ''} TL`;
  return { everyday: say(everyday), also: distinct([say(everyday), ...half]).slice(1), written: say(written) };
}
