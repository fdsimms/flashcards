/** Spanish numbers in words, 0 to 999,999: what the tools that say a time, a date or an amount need. */

const UNITS = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
  'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve',
  'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
const TENS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const HUNDREDS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

function below100(n: number): string {
  return n < 30 ? UNITS[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ` y ${UNITS[n % 10]}` : '');
}

function below1000(n: number): string {
  if (n === 100) return 'cien';
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? HUNDREDS[h] : '', rest || !h ? below100(rest) : ''].filter(Boolean).join(' ');
}

/** "uno" cut to "un" before a masculine noun or mil: un peso, veintiún pesos, treinta y un mil. */
function apocope(word: string): string {
  return word.replace(/veintiuno$/, 'veintiún').replace(/uno$/, 'un');
}

/**
 * `n` (0 to 999,999) in words, standing alone (a year, a day, a minute): 21 is veintiuno, 45
 * cuarenta y cinco, 2026 dos mil veintiséis. `feminine` counts something feminine (horas): una,
 * veintiuna, doscientas.
 */
export function spanishNumber(n: number, feminine = false): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999) throw new RangeError(`Not a whole number from 0 to 999,999: ${n}`);
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;
  const word = thousands === 0 ? below1000(n)
    : [thousands === 1 ? 'mil' : `${apocope(below1000(thousands))} mil`, rest ? below1000(rest) : ''].filter(Boolean).join(' ');
  return feminine ? word.replace(/ientos\b/g, 'ientas').replace(/uno$/, 'una') : word;
}

/** `n` counting something masculine (pesos, centavos), with uno cut to un: un peso, veintiún pesos. */
export function spanishCount(n: number): string {
  return apocope(spanishNumber(n));
}
