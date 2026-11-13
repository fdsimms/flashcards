import { CURRENCIES, type MoneySaying } from '../money';
import { phrase } from '../phrase';
import { enWord } from './numbers';

/*
 * An amount of yen in Japanese: the number, then 円 (えん), 四円 being よえん. Prices are whole yen.
 * Written with digits and 円 after them, with commas: 1,277円.
 */

export function sayJapaneseMoney(amount: number): MoneySaying {
  const { minorPerMajor } = CURRENCIES.JPY;
  if (!Number.isInteger(amount) || amount <= 0 || amount % minorPerMajor) throw new RangeError(`Not an amount of whole yen: ${amount}`);
  const yen = amount / minorPerMajor;
  return { everyday: phrase([enWord(yen)], ''), also: [], written: { text: `${yen.toLocaleString('en-US')}円` } };
}
