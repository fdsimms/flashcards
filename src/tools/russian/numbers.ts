/**
 * Russian numbers 0 to 59 in words, in the nominative and the genitive, masculine (час) or
 * feminine (минута), and the noun form a number takes after it (1 минута, 2 минуты, 5 минут).
 */

export type Gender = 'm' | 'f';

const UNITS = ['ноль', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const TEENS = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят'];
const UNITS_GEN = ['', 'одного', 'двух', 'трёх', 'четырёх', 'пяти', 'шести', 'семи', 'восьми', 'девяти'];
const TENS_GEN = ['', '', 'двадцати', 'тридцати', 'сорока', 'пятидесяти'];

function check(n: number) {
  if (!Number.isInteger(n) || n < 0 || n > 59) throw new RangeError(`Not a whole number from 0 to 59: ${n}`);
}

function unit(u: number, gender: Gender): string {
  if (gender === 'f' && u === 1) return 'одна';
  if (gender === 'f' && u === 2) return 'две';
  return UNITS[u];
}

/** `n` (0 to 59) in the nominative: 21 двадцать один, or двадцать одна for a feminine noun. */
export function russianNumber(n: number, gender: Gender = 'm'): string {
  check(n);
  if (n < 10) return unit(n, gender);
  if (n < 20) return TEENS[n - 10];
  const u = n % 10;
  return u ? `${TENS[Math.floor(n / 10)]} ${unit(u, gender)}` : TENS[n / 10];
}

/** `n` (1 to 59) in the genitive, as after без: двух, пяти, двадцати одной. */
export function russianNumberGenitive(n: number, gender: Gender = 'm'): string {
  check(n);
  if (n === 0) throw new RangeError('No genitive for 0 here');
  const ones = (u: number) => (u === 1 && gender === 'f' ? 'одной' : UNITS_GEN[u]);
  if (n < 10) return ones(n);
  if (n < 20) return TEENS[n - 10].slice(0, -1) + 'и';
  const u = n % 10;
  return u ? `${TENS_GEN[Math.floor(n / 10)]} ${ones(u)}` : TENS_GEN[n / 10];
}

/** The noun after the number `n`: `one` after 1, 21, 31; `few` after 2-4, 22-24; `many` after the rest, 11-14 included. */
export function countForm(n: number, one: string, few: string, many: string): string {
  if (n % 100 >= 11 && n % 100 <= 14) return many;
  if (n % 10 === 1) return one;
  if (n % 10 >= 2 && n % 10 <= 4) return few;
  return many;
}
