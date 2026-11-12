/** French numbers in words, 0 to 59: what the tools that say a time need. */

const UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf',
  'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
const TENS = ['', '', 'vingt', 'trente', 'quarante', 'cinquante'];

/**
 * `n` (0 to 59) in words, in the traditional spelling: 21 is vingt et un, 45 quarante-cinq.
 * `feminine` counts something feminine (heures, minutes): une, vingt et une.
 */
export function frenchNumber(n: number, feminine = false): string {
  if (!Number.isInteger(n) || n < 0 || n > 59) throw new RangeError(`Not a whole number from 0 to 59: ${n}`);
  const units = n % 10;
  const word = n < 20 ? UNITS[n]
    : TENS[Math.floor(n / 10)] + (units === 1 ? ' et un' : units ? `-${UNITS[units]}` : '');
  return feminine ? word.replace(/\bun$/, 'une') : word;
}
