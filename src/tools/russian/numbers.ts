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

const TENS_ALL = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

/** `n` below 1000, as words (none for 0). */
function belowThousand(n: number, gender: Gender): string[] {
  const words: string[] = [];
  if (n >= 100) words.push(HUNDREDS[Math.floor(n / 100)]);
  const rest = n % 100;
  if (rest >= 10 && rest < 20) words.push(TEENS[rest - 10]);
  else {
    if (rest >= 20) words.push(TENS_ALL[Math.floor(rest / 10)]);
    if (rest % 10) words.push(unit(rest % 10, gender));
  }
  return words;
}

/**
 * `n` (0 to 999,999) in the nominative, for an amount: 1277 тысяча двести семьдесят семь, 2000
 * две тысячи (тысяча is feminine), 21 000 двадцать одна тысяча. A bare 1000 is тысяча.
 */
export function russianCardinal(n: number, gender: Gender = 'm'): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999) throw new RangeError(`Not a whole number from 0 to 999,999: ${n}`);
  if (n === 0) return UNITS[0];
  const words: string[] = [];
  const thousands = Math.floor(n / 1000);
  if (thousands === 1) words.push('тысяча');
  else if (thousands) words.push(...belowThousand(thousands, 'f'), countForm(thousands, 'тысяча', 'тысячи', 'тысяч'));
  words.push(...belowThousand(n % 1000, gender));
  return words.join(' ');
}

// Ordinals, masculine/neuter genitive (-ого) and neuter nominative (-ое), for dates and years.
const ORD_UNITS_GEN = ['', 'первого', 'второго', 'третьего', 'четвёртого', 'пятого', 'шестого', 'седьмого', 'восьмого', 'девятого'];
const ORD_TEENS_GEN = ['десятого', 'одиннадцатого', 'двенадцатого', 'тринадцатого', 'четырнадцатого', 'пятнадцатого', 'шестнадцатого', 'семнадцатого', 'восемнадцатого', 'девятнадцатого'];
const ORD_TENS_GEN = ['', '', 'двадцатого', 'тридцатого', 'сорокового', 'пятидесятого', 'шестидесятого', 'семидесятого', 'восьмидесятого', 'девяностого'];
const ORD_HUNDREDS_GEN = ['', 'сотого', 'двухсотого', 'трёхсотого', 'четырёхсотого', 'пятисотого', 'шестисотого', 'семисотого', 'восьмисотого', 'девятисотого'];
const ORD_UNITS_NOM = ['', 'первое', 'второе', 'третье', 'четвёртое', 'пятое', 'шестое', 'седьмое', 'восьмое', 'девятое'];
const ORD_TEENS_NOM = ['десятое', 'одиннадцатое', 'двенадцатое', 'тринадцатое', 'четырнадцатое', 'пятнадцатое', 'шестнадцатое', 'семнадцатое', 'восемнадцатое', 'девятнадцатое'];
const ORD_TENS_NOM = ['', '', 'двадцатое', 'тридцатое'];

/** The ordinal of 1 to 99; only its last word is an ordinal (двадцать шестого). */
function ordinalBelowHundred(n: number, units: string[], teens: string[], tens: string[]): string {
  if (n < 10) return units[n];
  if (n < 20) return teens[n - 10];
  const u = n % 10;
  return u ? `${TENS_ALL[Math.floor(n / 10)]} ${units[u]}` : tens[n / 10];
}

/** A day of the month (1 to 31) as a neuter ordinal in the nominative: двенадцатое, двадцать первое. */
export function dayOrdinal(day: number): string {
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new RangeError(`Not a day of the month: ${day}`);
  return ordinalBelowHundred(day, ORD_UNITS_NOM, ORD_TEENS_NOM, ORD_TENS_NOM);
}

/** The same in the genitive: двенадцатого, двадцать первого. */
export function dayOrdinalGenitive(day: number): string {
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new RangeError(`Not a day of the month: ${day}`);
  return ordinalBelowHundred(day, ORD_UNITS_GEN, ORD_TEENS_GEN, ORD_TENS_GEN);
}

/**
 * A year (1 to 9999) as an ordinal in the genitive, as before года: only the last part is an
 * ordinal, the rest cardinal. 2026 две тысячи двадцать шестого, 1950 тысяча девятьсот
 * пятидесятого, 2000 двухтысячного.
 */
export function yearOrdinalGenitive(year: number): string {
  if (!Number.isInteger(year) || year < 1 || year > 9999) throw new RangeError(`Not a year from 1 to 9999: ${year}`);
  const rest = year % 100;
  const head = year - rest;
  if (rest) return [head ? russianCardinal(head) : '', ordinalBelowHundred(rest, ORD_UNITS_GEN, ORD_TEENS_GEN, ORD_TENS_GEN)].filter(Boolean).join(' ');
  const hundreds = (year % 1000) / 100;
  const thousands = Math.floor(year / 1000);
  if (hundreds) return [thousands ? russianCardinal(thousands * 1000) : '', ORD_HUNDREDS_GEN[hundreds]].filter(Boolean).join(' ');
  // A whole thousand: one word, from the genitive of the count (двух-, трёх-), 1000 тысячного.
  return `${thousands === 1 ? '' : UNITS_GEN[thousands]}тысячного`;
}

// Ordinals, masculine nominative, for a year said on its own (год is understood).
const ORD_UNITS_MASC = ['', 'первый', 'второй', 'третий', 'четвёртый', 'пятый', 'шестой', 'седьмой', 'восьмой', 'девятый'];
const ORD_TEENS_MASC = ['десятый', 'одиннадцатый', 'двенадцатый', 'тринадцатый', 'четырнадцатый', 'пятнадцатый', 'шестнадцатый', 'семнадцатый', 'восемнадцатый', 'девятнадцатый'];
const ORD_TENS_MASC = ['', '', 'двадцатый', 'тридцатый', 'сороковой', 'пятидесятый', 'шестидесятый', 'семидесятый', 'восьмидесятый', 'девяностый'];
const ORD_HUNDREDS_MASC = ['', 'сотый', 'двухсотый', 'трёхсотый', 'четырёхсотый', 'пятисотый', 'шестисотый', 'семисотый', 'восьмисотый', 'девятисотый'];

/** The cases a year's ordinal is said in here: on its own (nominative), or after в (prepositional). */
export type YearCase = 'nominative' | 'prepositional';

/** -ый/-ой/-ий to -ом, третий to третьем: в первом, во втором, в третьем. */
const prepositional = (ordinal: string) => (ordinal.endsWith('третий') ? `${ordinal.slice(0, -2)}ьем` : ordinal.replace(/(ый|ой)$/, 'ом'));

/**
 * A year (1 to 9999) as a masculine ordinal in `c`: only the last word is an ordinal, the rest
 * cardinal. 1987 тысяча девятьсот восемьдесят седьмой, after в восемьдесят седьмом (году);
 * 2000 двухтысячный, 1900 тысяча девятисотый.
 */
export function yearOrdinal(year: number, c: YearCase): string {
  if (!Number.isInteger(year) || year < 1 || year > 9999) throw new RangeError(`Not a year from 1 to 9999: ${year}`);
  const inflect = (o: string) => (c === 'nominative' ? o : prepositional(o));
  const rest = year % 100;
  const head = year - rest;
  if (rest) return [head ? russianCardinal(head) : '', inflect(ordinalBelowHundred(rest, ORD_UNITS_MASC, ORD_TEENS_MASC, ORD_TENS_MASC))].filter(Boolean).join(' ');
  const hundreds = (year % 1000) / 100;
  const thousands = Math.floor(year / 1000);
  if (hundreds) return [thousands ? russianCardinal(thousands * 1000) : '', inflect(ORD_HUNDREDS_MASC[hundreds])].filter(Boolean).join(' ');
  return inflect(`${thousands === 1 ? '' : UNITS_GEN[thousands]}тысячный`);
}
