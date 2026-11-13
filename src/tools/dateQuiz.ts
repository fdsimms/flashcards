import { daysInMonth, randomDate, shiftMonth, type CalendarDate, type DateParts, type DateSaying } from './date';
import { distinct, type Phrase } from './phrase';

/**
 * Saying dates as a quiz, besides saying it aloud: the ways to answer, every form of a date a
 * typed answer may take, and the wrong phrases offered beside the right one. Pure; nothing is
 * scheduled or saved.
 */

/** Say it aloud and show the answer; pick the phrase; type it; or read the phrase and tap the date. */
export const DATE_MODES = ['say', 'pick', 'type', 'tap'] as const;
export type DateMode = (typeof DATE_MODES)[number];

/** A reading in kana only: Japanese's, which a typed answer may give in place of the kanji. */
const KANA_READING = /^[\p{Script=Hiragana}\p{Script=Katakana}ー\s]+$/u;

/**
 * Every way of saying the date that a typed answer is accepted in: the usual one, the others heard,
 * the digits as written, and in Japanese each of those typed in kana, as its reading.
 */
export function acceptedForms(saying: DateSaying): Phrase[] {
  const forms = [saying.everyday, ...saying.also, { ...saying.written, note: saying.written.note ?? 'As written' }, ...(saying.writtenAlso ?? [])];
  const readings = forms.flatMap((f) => (f.roman && KANA_READING.test(f.roman) ? [{ text: f.roman.replace(/\s/g, ''), note: 'In kana' }] : []));
  return distinct([...forms, ...readings]);
}

export function sameDate(a: CalendarDate, b: CalendarDate): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

/**
 * The date a question asks about, drawn as `date` (any year from FIRST_YEAR to LAST_YEAR). Tapping
 * the date with the year left unsaid can only be answered in the year the calendar opens on
 * (`today`'s), so that question asks about `date`'s day and month in that year, February 29 falling
 * back to the 28th outside a leap year. Every other question asks about `date` itself.
 */
export function quizDate(date: CalendarDate, mode: DateMode, parts: DateParts, today: CalendarDate): CalendarDate {
  if (mode !== 'tap' || parts.year) return date;
  return { year: today.year, month: date.month, day: Math.min(date.day, daysInMonth(today.year, date.month)) };
}

/**
 * A new date to draw after `drawn`, one whose asked date (`quizDate`) differs from the current
 * one. Tapped with the year unsaid, every year's 12 March asks the same 12 March, so a plain
 * `randomDate` could draw a question that looks like the last one and leave its answer up.
 */
export function nextQuizDraw(drawn: CalendarDate, mode: DateMode, parts: DateParts, today: CalendarDate, random: () => number = Math.random): CalendarDate {
  const asked = quizDate(drawn, mode, parts, today);
  for (;;) {
    const next = randomDate(drawn, random);
    if (!sameDate(quizDate(next, mode, parts, today), asked)) return next;
  }
}

/**
 * The month the calendar opens on to tap the date: `today`'s, in the asked date's year when the
 * year is said, so finding it means moving a few months rather than paging through decades.
 */
export function quizCalendarStart(date: CalendarDate, parts: DateParts, today: CalendarDate): CalendarDate {
  return parts.year ? { year: date.year, month: today.month, day: 1 } : { year: today.year, month: today.month, day: 1 };
}

/** The date `n` days after `d` (before, when negative). */
export function addDays(d: CalendarDate, n: number): CalendarDate {
  let { year, month, day } = d;
  for (let left = n; left > 0; left--) {
    if (day < daysInMonth(year, month)) day++;
    else {
      day = 1;
      if (++month > 12) { month = 1; year++; }
    }
  }
  for (let left = n; left < 0; left++) {
    if (day > 1) day--;
    else {
      if (--month < 1) { month = 12; year--; }
      day = daysInMonth(year, month);
    }
  }
  return { year, month, day };
}

export interface DateOption {
  /** The date this phrase says, so a wrong pick can say which one it was. */
  date: CalendarDate;
  phrase: Phrase;
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The phrase for `date` among three for nearby dates, in random order: one a few days off, one a
 * few months off and, when the year is said, one a year or two off, so each wrong one is a real
 * phrase for a real date that differs in one thing to read carefully. `correct` is the right one's index.
 */
export function dateOptions(
  date: CalendarDate,
  parts: DateParts,
  say: (d: CalendarDate, parts: DateParts) => DateSaying,
  random: () => number = Math.random,
): { options: DateOption[]; correct: number } {
  const make = (d: CalendarDate): DateOption => ({ date: d, phrase: say(d, parts).everyday });
  const right = make(date);
  const days = [-3, -2, -1, 1, 2, 3].map((n) => addDays(date, n));
  const months = [-3, -2, -1, 1, 2, 3].map((n) => shiftMonth(date, n));
  const years = parts.year ? [-2, -1, 1, 2].map((n) => shiftMonth(date, 12 * n)) : [];

  const seen = new Set([right.phrase.text]);
  const wrong: DateOption[] = [];
  const take = (pool: CalendarDate[], one: boolean) => {
    for (const d of shuffled(pool, random)) {
      if (wrong.length >= 3) return;
      const o = make(d);
      if (seen.has(o.phrase.text)) continue;
      seen.add(o.phrase.text);
      wrong.push(o);
      if (one) return;
    }
  };
  take(days, true);
  take(months, true);
  take(years, true);
  take([...days, ...months, ...years], false);

  const options = shuffled([right, ...wrong], random);
  return { options, correct: options.indexOf(right) };
}
