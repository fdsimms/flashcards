/**
 * Turkish numbers in words. Every number is separate words with no "and" and no inflection: bin iki
 * yüz yetmiş yedi. One hundred and one thousand are just yüz and bin (never bir yüz, bir bin), also
 * after another number (bin yüz is 1,100, iki bin yüz 2,100). Turkish has no spoken ordinal that the
 * tools need: a date's day and a year are plain numbers.
 */

const ONES = ['sıfır', 'bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz'];
const TENS = ['', 'on', 'yirmi', 'otuz', 'kırk', 'elli', 'altmış', 'yetmiş', 'seksen', 'doksan'];

/** `n` (0 to 99) in words: on iki, yirmi bir, doksan dokuz. */
export function turkishNumber(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 99) throw new RangeError(`Not a whole number from 0 to 99: ${n}`);
  if (n < 10) return ONES[n];
  const units = n % 10;
  return units ? `${TENS[Math.floor(n / 10)]} ${ONES[units]}` : TENS[n / 10];
}

/** `n` (0 to 999,999) in words: sıfır, yüz, bin iki yüz yetmiş yedi, yüz bin. */
export function turkishCardinal(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999) throw new RangeError(`Not a whole number from 0 to 999,999: ${n}`);
  if (n < 100) return turkishNumber(n);
  const thousands = Math.floor(n / 1000);
  const hundreds = Math.floor((n % 1000) / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (thousands) parts.push(thousands === 1 ? 'bin' : `${turkishCardinal(thousands)} bin`);
  if (hundreds) parts.push(hundreds === 1 ? 'yüz' : `${ONES[hundreds]} yüz`);
  if (rest) parts.push(turkishNumber(rest));
  return parts.join(' ');
}
