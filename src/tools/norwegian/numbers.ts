/**
 * Norwegian (Bokmål) numbers in words, 0 to 99, in the counting taught today: tjueen, trettifem
 * (not the older enogtyve). One is "en"; the hour one o'clock is "ett", which the caller says.
 */

const ONES = ['null', 'en', 'to', 'tre', 'fire', 'fem', 'seks', 'sju', 'åtte', 'ni',
  'ti', 'elleve', 'tolv', 'tretten', 'fjorten', 'femten', 'seksten', 'sytten', 'atten', 'nitten'];
const TENS = ['', '', 'tjue', 'tretti', 'førti', 'femti', 'seksti', 'sytti', 'åtti', 'nitti'];

/** `n` (0 to 99) in words. */
export function norwegianNumber(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 99) throw new RangeError(`Not a whole number from 0 to 99: ${n}`);
  if (n < 20) return ONES[n];
  const units = n % 10;
  return TENS[Math.floor(n / 10)] + (units ? ONES[units] : '');
}

/**
 * `n` (0 to 999,999) in words, as Bokmål says them in separate words: hundre, to hundre og
 * syttisju, tusen to hundre og syttisju, tusen og fem. "og" comes before the last part when it's
 * under 100. One hundred and one thousand are hundre and tusen (ett hundre, ett tusen are heard
 * too; the caller offers them), but a hundred after thousands is ett hundre: tusen ett hundre.
 */
export function norwegianCardinal(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999) throw new RangeError(`Not a whole number from 0 to 999,999: ${n}`);
  if (n < 100) return norwegianNumber(n);
  const parts: string[] = [];
  const thousands = Math.floor(n / 1000);
  const hundreds = Math.floor((n % 1000) / 100);
  const rest = n % 100;
  if (thousands) parts.push(thousands === 1 ? 'tusen' : `${norwegianCardinal(thousands)} tusen`);
  // A hundred after thousands takes its "ett": tusen ett hundre (1,100), never tusen hundre.
  if (hundreds) parts.push(hundreds > 1 ? `${norwegianNumber(hundreds)} hundre` : thousands ? 'ett hundre' : 'hundre');
  if (rest) parts.push(`og ${norwegianNumber(rest)}`);
  return parts.join(' ');
}

const ORDINALS = ['', 'første', 'andre', 'tredje', 'fjerde', 'femte', 'sjette', 'sjuende', 'åttende', 'niende', 'tiende',
  'ellevte', 'tolvte', 'trettende', 'fjortende', 'femtende', 'sekstende', 'syttende', 'attende', 'nittende'];

/** The ordinal for `n` (1 to 99): første, tolvte, tjueførste, trettiende. */
export function norwegianOrdinal(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 99) throw new RangeError(`Not a whole number from 1 to 99: ${n}`);
  if (n < 20) return ORDINALS[n];
  const tens = norwegianNumber(n - (n % 10));
  return n % 10 ? tens + ORDINALS[n % 10] : `${tens}${tens.endsWith('e') ? 'nde' : 'ende'}`;
}
