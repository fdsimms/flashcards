import type { Language } from '../reader/api';
import { weekdayOf, type CalendarDate, type DateParts } from './date';
import type { Currency } from './money';
import type { NumberQuestion } from './number';
import type { ClockTime } from './time';

/**
 * The patterns a Practice question is made of, for marks.ts to lean toward the ones missed. A
 * miss is rarely about the one exact question (19:55 comes up once in 288 times at 5-minute steps)
 * but about how that kind is said: Thai's thûm hours, minutes said "to" the next hour, a Polish or
 * Russian amount ending in 2 to 4, an ordinal in the twenties. So each question gives a few
 * patterns, and every question sharing one comes up more often.
 */

/** Thai's six-hour clock (thai/time.ts): the part of the day an hour is said in. */
export function thaiHourBand(h: number): string {
  if (h === 0) return 'midnight';
  if (h <= 5) return 'dtii';
  if (h <= 11) return 'chao';
  if (h === 12) return 'noon';
  if (h <= 16) return 'baai';
  if (h <= 18) return 'yen';
  return 'thum';
}

/** On the hour, a quarter past, half past, a quarter to, other minutes past, other minutes to. */
function minuteKind(m: number): string {
  if (m === 0) return 'oclock';
  if (m === 15 || m === 30 || m === 45) return String(m);
  return m < 30 ? 'past' : 'to';
}

/** A time: its hour (in Thai, the part of the day it's said in; elsewhere, on the 12-hour clock) and the kind of minutes. */
export function timePatterns(t: ClockTime, language: Language): string[] {
  const hour = language === 'th' ? `band:${thaiHourBand(t.hour)}` : `hour:${t.hour % 12 || 12}`;
  return [hour, `minutes:${minuteKind(t.minute)}`];
}

/** How a number ends (11 to 19, 1, 2 to 4, 0, or 5 to 9), which picks the noun's form in Polish and Russian. */
function endingOf(n: number): string {
  const lastTwo = n % 100;
  const last = n % 10;
  return lastTwo >= 11 && lastTwo <= 19 ? 'teen' : last === 1 ? '1' : last >= 2 && last <= 4 ? '2-4' : last === 0 ? '0' : '5-9';
}

/**
 * An amount: how its whole part ends (`endingOf`), which picks the noun's form in Polish and
 * Russian and the number's in most languages; how its thousands end, which picks the thousands
 * word's (dwa tysiące, пять тысяч, χίλια or χιλιάδες); and whether it has a minor part.
 *
 * Only what sets some amounts apart from the rest: a pattern nearly every question has (how many
 * digits, a whole amount in a currency with no minor part) would lean toward everything at once,
 * which is no lean at all.
 */
export function moneyPatterns(amount: number, currency: Currency): string[] {
  const whole = Math.floor(amount / currency.minorPerMajor);
  const patterns = [`ends:${endingOf(whole)}`];
  if (whole >= 1000) patterns.push(`thousands:${endingOf(Math.floor(whole / 1000))}`);
  if (amount % currency.minorPerMajor !== 0) patterns.push('minor');
  return patterns;
}

/** A date: its month, its day's tens and ones (an ordinal's two parts), and the weekday and decade when they're said. */
export function datePatterns(d: CalendarDate, parts: DateParts): string[] {
  const patterns = [`month:${d.month}`, `day-tens:${Math.floor(d.day / 10)}`, `day-ones:${d.day % 10}`];
  if (parts.weekday) patterns.push(`weekday:${weekdayOf(d)}`);
  if (parts.year) patterns.push(`decade:${Math.floor(d.year / 10) * 10}`);
  return patterns;
}

/**
 * A Numbers question: for a plain number, how many digits it has and how it ends; for a year, its
 * decade and how it ends (the part said as an ordinal in Polish and Russian); for an age, its tens
 * and how it ends (the noun's form in Polish and Russian, the counter's sound in Japanese). A
 * phone number gives none: every one is made the same way, so there's nothing to lean toward.
 * Each is kept apart by kind, since a Polish age ending in 2 to 4 is a different matter from a
 * year ending so.
 */
export function numberPatterns(q: NumberQuestion): string[] {
  switch (q.kind) {
    case 'number': return [`number:digits:${String(q.n).length}`, `number:ends:${endingOf(q.n)}`];
    case 'year': return [`year:decade:${Math.floor(q.n / 10) * 10}`, `year:ends:${endingOf(q.n)}`];
    case 'age': return [`age:tens:${Math.floor(q.n / 10)}`, `age:ends:${endingOf(q.n)}`];
    case 'phone': return [];
  }
}
