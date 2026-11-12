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
