import type { Phrase } from './phrase';
import { pickOther } from './random';

/**
 * A calendar date for the Saying dates tool: its weekday, picking one at random, and how a
 * language says one. Pure arithmetic on the date's own numbers, never a JS Date, so no time zone
 * can move it to the day before.
 */

export interface CalendarDate {
  year: number;
  /** 1 (January) to 12. */
  month: number;
  /** 1 to 31. */
  day: number;
}

/** Which parts of a date are said besides the day and month. */
export interface DateParts {
  weekday: boolean;
  year: boolean;
}

/**
 * A date said in one language (each language's own date.ts makes one). No frame ("today is"):
 * just the date, in the case it takes standing alone. The day and month are always said; the
 * weekday and the year only when `DateParts` asks.
 */
export interface DateSaying {
  /** The usual way to say it. */
  everyday: Phrase;
  /** Other ways heard (an article, a short form, another era), each with a note when it needs one. */
  also: Phrase[];
  /** As it's written in the language, with digits: "jeudi 12 novembre 2026". Shown with the answer, never accepted as a typed one. */
  written: Phrase;
}

/** The years a random date comes from. */
export const FIRST_YEAR = 1950;
export const LAST_YEAR = 2049;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  return month === 2 ? (isLeapYear(year) ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function isValidDate(d: CalendarDate): boolean {
  return Number.isInteger(d.year) && Number.isInteger(d.month) && Number.isInteger(d.day)
    && d.month >= 1 && d.month <= 12 && d.day >= 1 && d.day <= daysInMonth(d.year, d.month);
}

/** 0 for Sunday to 6 for Saturday (Sakamoto's method, Gregorian calendar). */
export function weekdayOf(d: CalendarDate): number {
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const y = d.month < 3 ? d.year - 1 : d.year;
  return (y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + t[d.month - 1] + d.day) % 7;
}

/** The days from FIRST_YEAR's 1 January to `d`'s, counting from 0. */
function dayIndex(d: CalendarDate): number {
  let n = 0;
  for (let y = FIRST_YEAR; y < d.year; y++) n += isLeapYear(y) ? 366 : 365;
  for (let m = 1; m < d.month; m++) n += daysInMonth(d.year, m);
  return n + d.day - 1;
}

function dateAt(index: number): CalendarDate {
  let year = FIRST_YEAR;
  let n = index;
  while (n >= (isLeapYear(year) ? 366 : 365)) { n -= isLeapYear(year) ? 366 : 365; year++; }
  let month = 1;
  while (n >= daysInMonth(year, month)) { n -= daysInMonth(year, month); month++; }
  return { year, month, day: n + 1 };
}

/** A date at random from FIRST_YEAR to LAST_YEAR, never `previous` again. */
export function randomDate(previous?: CalendarDate, random: () => number = Math.random): CalendarDate {
  const count = dayIndex({ year: LAST_YEAR + 1, month: 1, day: 1 });
  const last = previous && previous.year >= FIRST_YEAR && previous.year <= LAST_YEAR ? dayIndex(previous) : undefined;
  return dateAt(pickOther(count, last, random));
}

/** The month before or after `d`'s (`by` -1 or 1), on the same day where it has one, else its last. */
export function shiftMonth(d: CalendarDate, by: number): CalendarDate {
  const zero = d.year * 12 + (d.month - 1) + by;
  const year = Math.floor(zero / 12);
  const month = (zero % 12) + 1;
  return { year, month, day: Math.min(d.day, daysInMonth(year, month)) };
}
