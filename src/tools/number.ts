import type { Language } from '../reader/api';
import { FIRST_YEAR, LAST_YEAR } from './date';
import type { Phrase } from './phrase';
import { pickOther } from './random';
import { buddhistYear } from './thai/date';

/**
 * Numbers for the Numbers tool: what kind of number is asked (a plain number, a phone number, a
 * year, an age), picking one at random, how each language writes it on the question card, and
 * checking the digits typed after hearing one. Each language's own number.ts says it.
 */

export const NUMBER_KINDS = ['number', 'phone', 'year', 'age'] as const;
export type NumberKind = (typeof NUMBER_KINDS)[number];

/** Say it aloud and show the answer, or hear it and type the digits. */
export const NUMBER_MODES = ['say', 'listen'] as const;
export type NumberMode = (typeof NUMBER_MODES)[number];

/**
 * A question. A phone number is kept as written (`0X XX XX XX XX`), since its groups are how it's
 * read; the rest are a number. A year is the Christian year, whatever the language counts from.
 */
export type NumberQuestion =
  | { kind: 'number' | 'year' | 'age'; n: number }
  | { kind: 'phone'; written: string };

/** A number said in one language. */
export interface NumberSaying {
  /** The usual way to say it. */
  everyday: Phrase;
  /** Other ways heard, each with a note where it needs one. */
  also: Phrase[];
}

/** The largest plain number asked: every language's words go this far (999,999). */
export const MAX_NUMBER = 999_999;

/** The youngest and oldest age asked: one year old takes the singular, a case of its own in every language. */
export const MIN_AGE = 2;
export const MAX_AGE = 99;

/**
 * Each language's mobile numbers, as written there: X is any digit, anything else is written as
 * it stands. The groups are the ones the number is read in (in pairs in French and Mexican
 * Spanish, in threes in Polish, 3-3-2-2 in Russian), so a format sets how it's said too.
 */
export const PHONE_FORMATS: Record<Exclude<Language, 'en'>, string[]> = {
  th: ['06X XXX XXXX', '08X XXX XXXX', '09X XXX XXXX'],
  es: ['55 XXXX XXXX', '33 XXXX XXXX', '81 XXXX XXXX'],
  fr: ['06 XX XX XX XX', '07 XX XX XX XX'],
  de: ['0151 XXXXXXXX', '0170 XXXXXXX', '0176 XXXXXXXX'],
  el: ['69X XXX XXXX'],
  ja: ['090-XXXX-XXXX', '080-XXXX-XXXX', '070-XXXX-XXXX'],
  nb: ['4XX XX XXX', '9XX XX XXX'],
  pl: ['5XX XXX XXX', '6XX XXX XXX', '7XX XXX XXX', '88X XXX XXX'],
  ru: ['8 9XX XXX-XX-XX'],
};

/** A phone number's groups of digits, as written: "06 42 17 85 93" is 06, 42, 17, 85, 93. */
export function phoneGroups(written: string): string[] {
  return written.split(/\D+/).filter(Boolean);
}

/** A phone number from `format` (X is any digit). */
export function fillPhone(format: string, random: () => number = Math.random): string {
  return format.replace(/X/g, () => String(Math.floor(random() * 10)));
}

/**
 * How a language writes the thousands of a plain number: a comma (Thai, Mexico, Japan), a dot
 * (German, Greek), or a space (a narrow one in French, Polish and Russian), as its money does.
 */
const THOUSANDS: Record<Exclude<Language, 'en'>, string> = {
  th: ',', es: ',', ja: ',', de: '.', el: '.', nb: ' ', fr: ' ', pl: ' ', ru: ' ',
};

/** A plain number with the language's thousands separator: 1 277, 1.277, 1,277. */
export function groupThousands(n: number, language: Language): string {
  const sep = language === 'en' ? ',' : THOUSANDS[language];
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

/**
 * What the question card shows, as the language writes it. A Thai year is in the Buddhist Era
 * (พ.ศ. 2530), as Thai writes one, and that's the number said. A year is written without a
 * separator in every language.
 */
export function questionText(q: NumberQuestion, language: Language): string {
  switch (q.kind) {
    case 'phone': return q.written;
    case 'number': return groupThousands(q.n, language);
    case 'year': return language === 'th' ? `พ.ศ. ${buddhistYear(q.n)}` : String(q.n);
    case 'age': return String(q.n);
  }
}

/** The digits a typed answer is checked against: the ones on the question card, nothing else. */
export function answerDigits(q: NumberQuestion, language: Language): string {
  return questionText(q, language).replace(/\D/g, '');
}

/**
 * Whether typed digits are the number heard. Anything but digits is ignored (spaces, dashes, a
 * separator), so 06 42 17 85 93, 0642178593 and 06-42-17-85-93 are all the same answer. Digits
 * typed on a keyboard of another script (๐-๙, the full-width ０-９) count as their 0-9.
 */
export function checkDigits(typed: string, q: NumberQuestion, language: Language): boolean {
  const digits = normalizeDigits(typed).replace(/\D/g, '');
  return digits.length > 0 && digits === answerDigits(q, language);
}

/** Thai and full-width digits as 0-9. */
export function normalizeDigits(text: string): string {
  return text
    .replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - 0x0e50))
    .replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10));
}

/** What makes a question the same question, to tell it from another (retries, Randomize). */
export function questionKey(q: NumberQuestion): string {
  return q.kind === 'phone' ? `phone:${q.written}` : `${q.kind}:${q.n}`;
}

/** A whole number from `lo` to `hi`, never `previous` when there's another. */
function between(lo: number, hi: number, previous: number | undefined, random: () => number): number {
  const prev = previous !== undefined && previous >= lo && previous <= hi ? previous - lo : undefined;
  return lo + pickOther(hi - lo + 1, prev, random);
}

/**
 * A question of `kind` at random, never `previous` again. A plain number first picks how many
 * digits it has (1 to 6, evenly), so 7 comes up as often as 482,315 does, rather than almost never.
 */
export function randomQuestion(kind: NumberKind, language: Language, previous?: NumberQuestion, random: () => number = Math.random): NumberQuestion {
  const prevN = previous && previous.kind === kind && previous.kind !== 'phone' ? previous.n : undefined;
  switch (kind) {
    case 'number': {
      const digits = 1 + Math.floor(random() * 6);
      return { kind, n: between(digits === 1 ? 0 : 10 ** (digits - 1), 10 ** digits - 1, prevN, random) };
    }
    case 'year': return { kind, n: between(FIRST_YEAR, LAST_YEAR, prevN, random) };
    case 'age': return { kind, n: between(MIN_AGE, MAX_AGE, prevN, random) };
    case 'phone': {
      const formats = language === 'en' ? PHONE_FORMATS.es : PHONE_FORMATS[language];
      for (;;) {
        const written = fillPhone(formats[Math.floor(random() * formats.length)], random);
        if (!previous || previous.kind !== 'phone' || previous.written !== written) return { kind, written };
      }
    }
  }
}

/** Groups said digit by digit, `word` naming each digit: "cinco cinco, uno dos tres cuatro". */
export function digitByDigit(groups: string[], word: (d: number) => string, digitGlue = ' ', groupGlue = ', '): string {
  return groups.map((g) => [...g].map((d) => word(Number(d))).join(digitGlue)).join(groupGlue);
}

/**
 * A group read as a number, as most languages read a phone number's pairs and threes: its leading
 * zeros one by one, then the rest as a number ("05" zéro cinq, "045" zero czterdzieści pięć).
 */
export function groupAsNumber(group: string, zero: string, number: (n: number) => string): string {
  const zeros = group.match(/^0*/)![0].length;
  const rest = group.slice(zeros);
  return [...Array<string>(zeros).fill(zero), ...(rest ? [number(Number(rest))] : [])].join(' ');
}
