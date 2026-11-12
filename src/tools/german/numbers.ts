/** German numbers in words, 0 to 99: einundzwanzig, dreißig. */

const ONES = ['null', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun',
  'zehn', 'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn'];
const TENS = ['', '', 'zwanzig', 'dreißig', 'vierzig', 'fünfzig', 'sechzig', 'siebzig', 'achtzig', 'neunzig'];

/** `n` (0 to 99) in words. 1 alone is eins; before Uhr it's ein, which the caller says. */
export function germanNumber(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 99) throw new RangeError(`Not a whole number from 0 to 99: ${n}`);
  if (n < 20) return ONES[n];
  const units = n % 10;
  const tens = TENS[Math.floor(n / 10)];
  if (!units) return tens;
  return `${units === 1 ? 'ein' : ONES[units]}und${tens}`;
}

/**
 * `n` (0 to 999,999) in words, written as one word as German writes numbers: hundert, tausend,
 * tausendzweihundertsiebenundsiebzig. A final 1 is eins (hunderteins); before a noun it's ein,
 * which the caller says (`beforeNoun`).
 */
export function germanCardinal(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999) throw new RangeError(`Not a whole number from 0 to 999,999: ${n}`);
  if (n < 100) return germanNumber(n);
  const thousands = Math.floor(n / 1000);
  const hundreds = Math.floor((n % 1000) / 100);
  const rest = n % 100;
  let out = '';
  if (thousands) out += `${thousands === 1 ? '' : germanCardinal(thousands).replace(/eins$/, 'ein')}tausend`;
  if (hundreds) out += `${hundreds === 1 ? '' : germanNumber(hundreds)}hundert`;
  if (rest) out += germanNumber(rest);
  return out;
}

/** `n` in words before a noun: a final eins becomes ein (ein Euro, hundertein Euro). */
export function germanCardinalBeforeNoun(n: number): string {
  return germanCardinal(n).replace(/eins$/, 'ein');
}

/**
 * The stem of the ordinal for `n` (1 to 99), which takes its ending from the case: erst-, zweit-,
 * dritt-, siebt-, acht-, zwölft-, zwanzigst-, einunddreißigst-. Add -e after der, -en after am.
 */
export function germanOrdinalStem(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 99) throw new RangeError(`Not a whole number from 1 to 99: ${n}`);
  const irregular: Record<number, string> = { 1: 'erst', 3: 'dritt', 7: 'siebt', 8: 'acht' };
  if (irregular[n]) return irregular[n];
  return n < 20 ? `${germanNumber(n)}t` : `${germanNumber(n)}st`;
}

/** A year in words: 1950 is neunzehnhundertfünfzig, 2026 zweitausendsechsundzwanzig, 2001 zweitausendeins. */
export function germanYear(year: number): string {
  if (!Number.isInteger(year) || year < 1 || year > 9999) throw new RangeError(`Not a year: ${year}`);
  if (year >= 1100 && year < 2000) {
    const rest = year % 100;
    return `${germanNumber(Math.floor(year / 100))}hundert${rest ? germanNumber(rest) : ''}`;
  }
  return germanCardinal(year);
}
