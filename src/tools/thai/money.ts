import { CURRENCIES, type MoneySaying } from '../money';
import { distinct, phrase, type Phrase, type Word } from '../phrase';
import { thaiNumber } from './numbers';

/*
 * An amount of baht in Thai: the number, then บาท, and any satang after it (ห้าสิบสตางค์). A
 * leading หนึ่ง before ร้อย, พัน or หมื่น is usually left off in speech (ร้อยห้าสิบบาท,
 * พันสองร้อยบาท). Written with the baht sign and commas: ฿1,277, ฿12.50.
 */

const BAHT: Word = ['บาท', 'bàat'];
const SATANG: Word = ['สตางค์', 'sà-dtaang'];
const PLACES = new Set(['ร้อย', 'พัน', 'หมื่น', 'แสน']);

export function sayThaiMoney(amount: number): MoneySaying {
  if (!Number.isInteger(amount) || amount <= 0) throw new RangeError(`Not an amount: ${amount}`);
  const { minorPerMajor } = CURRENCIES.THB;
  const baht = Math.floor(amount / minorPerMajor);
  const satang = amount % minorPerMajor;
  const words = (bahtWords: Word[]): Word[] => [
    ...(baht ? [...bahtWords, BAHT] : []),
    ...(satang ? [...thaiNumber(satang), SATANG] : []),
  ];
  const full = baht ? thaiNumber(baht) : [];
  const everyday = phrase(words(full), '');
  const also: Phrase[] = [];
  if (full.length > 1 && full[0][0] === 'หนึ่ง' && PLACES.has(full[1][0])) {
    also.push(phrase(words(full.slice(1)), '', 'หนึ่ง left off, as it usually is in speech'));
  }
  const digits = baht.toLocaleString('en-US') + (satang ? `.${String(satang).padStart(2, '0')}` : '');
  return { everyday, also: distinct([everyday, ...also]).slice(1), written: { text: `฿${digits}` } };
}
