/** French numbers in words, 0 to 999,999: what the tools that say a time, a date or an amount need. */

const UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf',
  'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
const TENS = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];

/**
 * 1 to 99. `last` says nothing follows in the numeral, which is when quatre-vingts keeps its s
 * (quatre-vingts euros, but quatre-vingt mille). `belgian` counts the seventies and nineties as
 * Belgium and Switzerland do: septante, septante et un, nonante-deux.
 */
function below100(n: number, last: boolean, belgian = false): string {
  if (n < 20) return UNITS[n];
  if (belgian && (n >= 70 && n < 80 || n >= 90)) {
    const tens = n < 80 ? 'septante' : 'nonante';
    const units = n % 10;
    return tens + (units === 1 ? ' et un' : units ? `-${UNITS[units]}` : '');
  }
  if (n < 70) {
    const units = n % 10;
    return TENS[Math.floor(n / 10)] + (units === 1 ? ' et un' : units ? `-${UNITS[units]}` : '');
  }
  if (n < 80) return n === 71 ? 'soixante et onze' : `soixante-${UNITS[n - 60]}`;
  return n === 80 ? (last ? 'quatre-vingts' : 'quatre-vingt') : `quatre-vingt-${UNITS[n - 80] ?? below100(n - 80, last)}`;
}

/** 1 to 999: deux cents keeps its s only when nothing follows (deux cents, deux cent un, deux cent mille). */
function below1000(n: number, last: boolean, belgian = false): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const hundreds = h === 0 ? '' : h === 1 ? 'cent' : `${UNITS[h]} cent${rest === 0 && last ? 's' : ''}`;
  return [hundreds, rest ? below100(rest, last, belgian) : ''].filter(Boolean).join(' ');
}

/**
 * `n` (0 to 999,999) in words, in the traditional spelling: 21 is vingt et un, 45 quarante-cinq,
 * 80 quatre-vingts, 1277 mille deux cent soixante-dix-sept. `feminine` counts something feminine
 * (heures, minutes): une, vingt et une. `belgian` says the seventies and nineties as Belgium and
 * Switzerland do (`below100`).
 */
export function frenchNumber(n: number, feminine = false, belgian = false): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999) throw new RangeError(`Not a whole number from 0 to 999,999: ${n}`);
  if (n === 0) return UNITS[0];
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;
  const word = [
    thousands === 0 ? '' : thousands === 1 ? 'mille' : `${below1000(thousands, false, belgian)} mille`,
    rest ? below1000(rest, true, belgian) : '',
  ].filter(Boolean).join(' ');
  return feminine ? word.replace(/\bun$/, 'une') : word;
}
