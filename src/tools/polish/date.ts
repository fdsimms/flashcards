import { isValidDate, weekdayOf, type CalendarDate, type DateParts, type DateSaying } from '../date';
import type { Phrase } from '../phrase';
import { dayOrdinal, dayOrdinalGenitive, yearOrdinalGenitive } from './numbers';

/**
 * A date in Polish. Standing alone the day is a masculine ordinal (dzień is understood) and the
 * month in the genitive: dwunasty listopada. The year is a genitive ordinal before roku: dwa
 * tysiące dwudziestego szóstego roku. "On" a date puts the day in the genitive too (dwunastego
 * listopada), and the weekday after w in the accusative (w środę, we wtorek). Written: czwartek,
 * 12 listopada 2026 r.
 */

const MONTHS_GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
/** Sunday first, as weekdayOf counts. */
const WEEKDAYS = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
const ON_WEEKDAYS = ['w niedzielę', 'w poniedziałek', 'we wtorek', 'w środę', 'w czwartek', 'w piątek', 'w sobotę'];

const ON = 'Saying on which day';

const pl = (text: string, note?: string): Phrase => ({ text, ...(note ? { note } : {}) });

export function sayPolishDate(d: CalendarDate, parts: DateParts): DateSaying {
  if (!isValidDate(d)) throw new RangeError(`Not a date: ${d.year}-${d.month}-${d.day}`);
  const month = MONTHS_GEN[d.month - 1];
  const weekday = weekdayOf(d);
  const year = parts.year ? ` ${yearOrdinalGenitive(d.year)} roku` : '';
  const said = (day: string, weekdayWords: string) => `${parts.weekday ? `${weekdayWords}, ` : ''}${day} ${month}${year}`;
  return {
    everyday: pl(said(dayOrdinal(d.day), WEEKDAYS[weekday])),
    also: [pl(said(dayOrdinalGenitive(d.day), ON_WEEKDAYS[weekday]), ON)],
    written: pl(`${parts.weekday ? `${WEEKDAYS[weekday]}, ` : ''}${d.day} ${month}${parts.year ? ` ${d.year} r.` : ''}`),
  };
}
