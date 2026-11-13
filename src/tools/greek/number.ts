import { digitByDigit, phoneGroups, type NumberQuestion, type NumberSaying } from '../number';
import type { Phrase } from '../phrase';
import { greekCardinal, greekNumber } from './numbers';
import { greekRoman } from './translit';

/*
 * A number in Greek, neuter as numbers are counted: χίλια διακόσια εβδομήντα εφτά. A phone number
 * is read digit by digit, a pause between its groups. A year is a plain number. An age is είμαι,
 * the number in the genitive and χρονών: 1, 3 and 4 change (ενός, τριών, τεσσάρων), the rest
 * don't: είμαι τριάντα τεσσάρων χρονών, είμαι είκοσι πέντε χρονών.
 */

const say = (text: string, note?: string): Phrase => ({ text, roman: greekRoman(text), ...(note ? { note } : {}) });

const GENITIVE: Record<string, string> = { 'ένα': 'ενός', 'τρία': 'τριών', 'τέσσερα': 'τεσσάρων', 'δεκατρία': 'δεκατριών', 'δεκατέσσερα': 'δεκατεσσάρων' };

/** `n` (0 to 99) in the genitive, as an age is said: only a last ένα, τρία or τέσσερα changes. */
export function greekGenitive(n: number): string {
  return greekNumber(n, 'neuter').replace(/[^ ]+$/, (last) => GENITIVE[last] ?? last);
}

export function sayGreekNumber(q: NumberQuestion): NumberSaying {
  switch (q.kind) {
    case 'number': return { everyday: say(greekCardinal(q.n)), also: [] };
    case 'phone': return { everyday: say(digitByDigit(phoneGroups(q.written), (d) => greekNumber(d, 'neuter'))), also: [] };
    case 'year': return { everyday: say(greekCardinal(q.n)), also: [] };
    case 'age': return { everyday: say(`είμαι ${greekGenitive(q.n)} χρονών`), also: [] };
  }
}
