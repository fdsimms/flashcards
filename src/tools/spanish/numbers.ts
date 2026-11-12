/** Spanish numbers in words, 0 to 59: what the tools that say a time need. */

const UNITS = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
  'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve',
  'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
const TENS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta'];

/**
 * `n` (0 to 59) in words: 21 is veintiuno, 45 cuarenta y cinco. `feminine` counts something
 * feminine (horas): una, veintiuna, treinta y una.
 */
export function spanishNumber(n: number, feminine = false): string {
  if (!Number.isInteger(n) || n < 0 || n > 59) throw new RangeError(`Not a whole number from 0 to 59: ${n}`);
  const word = n < 30 ? UNITS[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ` y ${UNITS[n % 10]}` : '');
  return feminine ? word.replace(/uno$/, 'una') : word;
}
