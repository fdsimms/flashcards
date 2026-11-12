import type { Word } from '../phrase';

/**
 * Thai numbers in words, with a romanization for each. Shared by the tools that say a number
 * (a time, a date, an amount of money).
 */

export const SUUN: Word = ['ศูนย์', 'sǔun'];

const DIGITS: Word[] = [
  SUUN, ['หนึ่ง', 'nùeng'], ['สอง', 'sǒng'], ['สาม', 'sǎam'], ['สี่', 'sìi'],
  ['ห้า', 'hâa'], ['หก', 'hòk'], ['เจ็ด', 'jèt'], ['แปด', 'bpàet'], ['เก้า', 'gâo'],
];
const SIP: Word = ['สิบ', 'sìp'];
const YII: Word = ['ยี่', 'yîi'];
const ET: Word = ['เอ็ด', 'èt'];
const LAAN: Word = ['ล้าน', 'láan'];
/** Hundred, thousand, ten thousand, hundred thousand. */
const PLACES: Word[] = [['ร้อย', 'rói'], ['พัน', 'phan'], ['หมื่น', 'mùen'], ['แสน', 'sǎen']];

/**
 * `n` (a whole number from 0) in words: 21 is ยี่สิบเอ็ด, 100 หนึ่งร้อย, 1,000,000 หนึ่งล้าน.
 * A 1 in the units after anything else is เอ็ด (11, 101), a 1 in the tens is just สิบ, a 2 there ยี่สิบ.
 */
export function thaiNumber(n: number): Word[] {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`Not a whole number from 0: ${n}`);
  if (n === 0) return [SUUN];
  return below(n, false);
}

/** `n` > 0 in words; `after` says words come before it (in the same number), which makes a units 1 เอ็ด. */
function below(n: number, after: boolean): Word[] {
  if (n >= 1_000_000) {
    const rest = n % 1_000_000;
    return [...below(Math.floor(n / 1_000_000), after), LAAN, ...(rest ? below(rest, true) : [])];
  }
  const words: Word[] = [];
  for (let place = 5; place >= 2; place--) {
    const d = Math.floor(n / 10 ** place) % 10;
    if (d) words.push(DIGITS[d], PLACES[place - 2]);
  }
  const tens = Math.floor(n / 10) % 10;
  if (tens === 1) words.push(SIP);
  else if (tens === 2) words.push(YII, SIP);
  else if (tens) words.push(DIGITS[tens], SIP);
  const units = n % 10;
  if (units === 1 && (after || words.length)) words.push(ET);
  else if (units) words.push(DIGITS[units]);
  return words;
}
