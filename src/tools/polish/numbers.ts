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
