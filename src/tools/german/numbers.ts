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
