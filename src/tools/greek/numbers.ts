/**
 * Greek numbers in words, 0 to 99, as spoken (εφτά, οχτώ, εννιά). The hours take the feminine
 * (η ώρα): μία, τρεις, τέσσερις; minutes the neuter (τα λεπτά): ένα, τρία, τέσσερα.
 */

export type Gender = 'feminine' | 'neuter';

const ONES = ['μηδέν', 'ένα', 'δύο', 'τρία', 'τέσσερα', 'πέντε', 'έξι', 'εφτά', 'οχτώ', 'εννιά',
  'δέκα', 'έντεκα', 'δώδεκα', 'δεκατρία', 'δεκατέσσερα', 'δεκαπέντε', 'δεκαέξι', 'δεκαεφτά', 'δεκαοχτώ', 'δεκαεννιά'];
const FEMININE: Record<number, string> = { 1: 'μία', 3: 'τρεις', 4: 'τέσσερις', 13: 'δεκατρείς', 14: 'δεκατέσσερις' };
const TENS = ['', '', 'είκοσι', 'τριάντα', 'σαράντα', 'πενήντα', 'εξήντα', 'εβδομήντα', 'ογδόντα', 'ενενήντα'];

/** `n` (0 to 99) in words, its 1, 3 and 4 agreeing with `gender`. */
export function greekNumber(n: number, gender: Gender): string {
  if (!Number.isInteger(n) || n < 0 || n > 99) throw new RangeError(`Not a whole number from 0 to 99: ${n}`);
  const word = (k: number) => (gender === 'feminine' ? FEMININE[k] ?? ONES[k] : ONES[k]);
  if (n < 20) return word(n);
  const units = n % 10;
  return TENS[Math.floor(n / 10)] + (units ? ` ${word(units)}` : '');
}

/** The hundreds, neuter (the feminine ends in -ες: διακόσιες): εκατό alone, εκατόν before more. */
const HUNDREDS = ['', 'εκατό', 'διακόσια', 'τριακόσια', 'τετρακόσια', 'πεντακόσια', 'εξακόσια', 'εφτακόσια', 'οχτακόσια', 'εννιακόσια'];

/**
 * `n` (0 to 999,999) in words, neuter, as euros, cents and years are counted: χίλια διακόσια
 * εβδομήντα εφτά, εκατόν ένα. Thousands past one are χιλιάδες, counted in the feminine (τρεις
 * χιλιάδες, διακόσιες χιλιάδες).
 */
export function greekCardinal(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999) throw new RangeError(`Not a whole number from 0 to 999,999: ${n}`);
  if (n < 100) return greekNumber(n, 'neuter');
  const thousands = Math.floor(n / 1000);
  const below = n % 1000;
  const words: string[] = [];
  if (thousands === 1) words.push('χίλια');
  else if (thousands) words.push(`${hundredsFeminine(thousands)} χιλιάδες`);
  if (below >= 100) words.push(Math.floor(below / 100) === 1 && below % 100 ? 'εκατόν' : HUNDREDS[Math.floor(below / 100)]);
  if (below % 100) words.push(greekNumber(below % 100, 'neuter'));
  return words.join(' ');
}

/** 1 to 999 in the feminine, for counting χιλιάδες. */
function hundredsFeminine(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const words: string[] = [];
  if (h) words.push(h === 1 ? (rest ? 'εκατόν' : 'εκατό') : HUNDREDS[h].replace(/α$/, 'ες'));
  if (rest) words.push(greekNumber(rest, 'feminine'));
  return words.join(' ');
}
