/**
 * Polish numbers 0 to 59 in words, plain or with a feminine noun (minuta: dwie, dwadzieścia
 * dwie), and the feminine ordinals the hours are said with (godzina: druga, po drugiej).
 */

const UNITS = ['zero', 'jeden', 'dwa', 'trzy', 'cztery', 'pięć', 'sześć', 'siedem', 'osiem', 'dziewięć'];
const TEENS = ['dziesięć', 'jedenaście', 'dwanaście', 'trzynaście', 'czternaście', 'piętnaście', 'szesnaście', 'siedemnaście', 'osiemnaście', 'dziewiętnaście'];
const TENS = ['', '', 'dwadzieścia', 'trzydzieści', 'czterdzieści', 'pięćdziesiąt'];

/** `n` (0 to 59) in words; `feminine` makes 2 dwie (1 alone is jedna, but jeden in 21, 31). */
export function polishNumber(n: number, feminine = false): string {
  if (!Number.isInteger(n) || n < 0 || n > 59) throw new RangeError(`Not a whole number from 0 to 59: ${n}`);
  const unit = (u: number, alone: boolean) => (feminine && u === 2 ? 'dwie' : feminine && u === 1 && alone ? 'jedna' : UNITS[u]);
  if (n < 10) return unit(n, true);
  if (n < 20) return TEENS[n - 10];
  const u = n % 10;
  return u ? `${TENS[Math.floor(n / 10)]} ${unit(u, false)}` : TENS[n / 10];
}

const ORDINALS = ['', 'pierwsza', 'druga', 'trzecia', 'czwarta', 'piąta', 'szósta', 'siódma', 'ósma', 'dziewiąta', 'dziesiąta', 'jedenasta', 'dwunasta',
  'trzynasta', 'czternasta', 'piętnasta', 'szesnasta', 'siedemnasta', 'osiemnasta', 'dziewiętnasta', 'dwudziesta'];
const OBLIQUE = ['', 'pierwszej', 'drugiej', 'trzeciej', 'czwartej', 'piątej', 'szóstej', 'siódmej', 'ósmej', 'dziewiątej', 'dziesiątej', 'jedenastej', 'dwunastej',
  'trzynastej', 'czternastej', 'piętnastej', 'szesnastej', 'siedemnastej', 'osiemnastej', 'dziewiętnastej', 'dwudziestej'];

function checkHour(h: number) {
  if (!Number.isInteger(h) || h < 1 || h > 24) throw new RangeError(`Not an hour from 1 to 24: ${h}`);
}

/** The feminine ordinal of an hour, 1 to 24, in the nominative: druga, dwudziesta pierwsza. */
export function hourOrdinal(h: number): string {
  checkHour(h);
  return h > 20 ? `${ORDINALS[20]} ${ORDINALS[h - 20]}` : ORDINALS[h];
}

/** The same in the genitive or locative (one form for both): drugiej, as after po and wpół do. */
export function hourOrdinalOblique(h: number): string {
  checkHour(h);
  return h > 20 ? `${OBLIQUE[20]} ${OBLIQUE[h - 20]}` : OBLIQUE[h];
}

const TENS_ALL = ['', '', 'dwadzieścia', 'trzydzieści', 'czterdzieści', 'pięćdziesiąt', 'sześćdziesiąt', 'siedemdziesiąt', 'osiemdziesiąt', 'dziewięćdziesiąt'];
const HUNDREDS = ['', 'sto', 'dwieście', 'trzysta', 'czterysta', 'pięćset', 'sześćset', 'siedemset', 'osiemset', 'dziewięćset'];

/**
 * The noun after the number `n`: `one` after exactly 1; `few` after 2-4, 22-24, 102 and so on
 * (not 12-14); `many` after the rest, 21 and 25 included: jeden złoty, dwa złote, pięć złotych,
 * dwadzieścia jeden złotych.
 */
export function polishCountForm(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  if (n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14)) return few;
  return many;
}

/** `n` below 1000, as words (none for 0), with a masculine noun. */
function belowThousand(n: number): string[] {
  const words: string[] = [];
  if (n >= 100) words.push(HUNDREDS[Math.floor(n / 100)]);
  const rest = n % 100;
  if (rest >= 10 && rest < 20) words.push(TEENS[rest - 10]);
  else {
    if (rest >= 20) words.push(TENS_ALL[Math.floor(rest / 10)]);
    if (rest % 10) words.push(UNITS[rest % 10]);
  }
  return words;
}

/**
 * `n` (0 to 999,999) in words, with a masculine noun (złoty, grosz): 1277 tysiąc dwieście
 * siedemdziesiąt siedem, 2000 dwa tysiące, 5000 pięć tysięcy. A bare 1000 is tysiąc.
 */
export function polishCardinal(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999) throw new RangeError(`Not a whole number from 0 to 999,999: ${n}`);
  if (n === 0) return UNITS[0];
  const words: string[] = [];
  const thousands = Math.floor(n / 1000);
  if (thousands === 1) words.push('tysiąc');
  else if (thousands) words.push(...belowThousand(thousands), polishCountForm(thousands, 'tysiąc', 'tysiące', 'tysięcy'));
  words.push(...belowThousand(n % 1000));
  return words.join(' ');
}

// Masculine ordinals, nominative (-y/-i) and genitive (-ego), for dates and years. In Polish
// both the tens and the units of a compound ordinal are ordinals: dwudziesty pierwszy.
const ORD_UNITS = ['', 'pierwszy', 'drugi', 'trzeci', 'czwarty', 'piąty', 'szósty', 'siódmy', 'ósmy', 'dziewiąty'];
const ORD_TEENS = ['dziesiąty', 'jedenasty', 'dwunasty', 'trzynasty', 'czternasty', 'piętnasty', 'szesnasty', 'siedemnasty', 'osiemnasty', 'dziewiętnasty'];
const ORD_TENS = ['', '', 'dwudziesty', 'trzydziesty', 'czterdziesty', 'pięćdziesiąty', 'sześćdziesiąty', 'siedemdziesiąty', 'osiemdziesiąty', 'dziewięćdziesiąty'];
const ORD_HUNDREDS_GEN = ['', 'setnego', 'dwusetnego', 'trzysetnego', 'czterechsetnego', 'pięćsetnego', 'sześćsetnego', 'siedemsetnego', 'osiemsetnego', 'dziewięćsetnego'];

/** -y/-i to -ego: pierwszy pierwszego, drugi drugiego, trzeci trzeciego. */
const genitive = (ordinal: string) => (ordinal.endsWith('i') ? `${ordinal}ego` : `${ordinal.slice(0, -1)}ego`);

/** The masculine ordinal of 1 to 99 in the nominative: dwunasty, dwudziesty pierwszy. */
function ordinalBelowHundred(n: number): string[] {
  if (n < 10) return [ORD_UNITS[n]];
  if (n < 20) return [ORD_TEENS[n - 10]];
  return [ORD_TENS[Math.floor(n / 10)], ...(n % 10 ? [ORD_UNITS[n % 10]] : [])];
}

function checkDay(day: number) {
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new RangeError(`Not a day of the month: ${day}`);
}

/** A day of the month (1 to 31) as a masculine ordinal (dzień is understood): dwunasty, dwudziesty pierwszy. */
export function dayOrdinal(day: number): string {
  checkDay(day);
  return ordinalBelowHundred(day).join(' ');
}

/** The same in the genitive: dwunastego, dwudziestego pierwszego. */
export function dayOrdinalGenitive(day: number): string {
  checkDay(day);
  return ordinalBelowHundred(day).map(genitive).join(' ');
}

/** The cases a year's ordinal is said in: on its own, before roku (genitive), after w (locative). */
export type YearCase = 'nominative' | 'genitive' | 'locative';

/** -y/-i to -ym/-im: pierwszy pierwszym, drugi drugim. */
const locative = (ordinal: string) => `${ordinal}m`;
const inflect = (ordinal: string, c: YearCase) => (c === 'nominative' ? ordinal : c === 'genitive' ? genitive(ordinal) : locative(ordinal));
const ORD_HUNDREDS = ORD_HUNDREDS_GEN.map((g) => (g ? `${g.slice(0, -'ego'.length)}y` : ''));

/**
 * A year (1 to 9999) as a masculine ordinal (rok is understood) in `c`: the thousands and hundreds
 * stay cardinal, the tens and units are ordinals. 1987 tysiąc dziewięćset osiemdziesiąty siódmy,
 * before roku osiemdziesiątego siódmego, after w osiemdziesiątym siódmym; 2000 dwutysięczny.
 */
export function yearOrdinal(year: number, c: YearCase): string {
  if (!Number.isInteger(year) || year < 1 || year > 9999) throw new RangeError(`Not a year from 1 to 9999: ${year}`);
  const rest = year % 100;
  const head = year - rest;
  if (rest) return [head ? polishCardinal(head) : '', ...ordinalBelowHundred(rest).map((o) => inflect(o, c))].filter(Boolean).join(' ');
  const hundreds = (year % 1000) / 100;
  const thousands = Math.floor(year / 1000);
  if (hundreds) return [thousands ? polishCardinal(thousands * 1000) : '', inflect(ORD_HUNDREDS[hundreds], c)].filter(Boolean).join(' ');
  return inflect(`${['', '', 'dwu', 'trzy', 'cztero', 'pięcio', 'sześcio', 'siedmio', 'ośmio', 'dziewięcio'][thousands]}tysięczny`, c);
}

/**
 * A year as a genitive ordinal, as before roku: 2026 dwa tysiące dwudziestego szóstego, 1950
 * tysiąc dziewięćset pięćdziesiątego, 2000 dwutysięcznego.
 */
export function yearOrdinalGenitive(year: number): string {
  return yearOrdinal(year, 'genitive');
}
