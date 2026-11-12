import { type CalendarDate, type DateParts, type DateSaying, isValidDate, weekdayOf } from '../date';
import { distinct, type Phrase } from '../phrase';
import { germanOrdinalStem, germanYear } from './numbers';

/**
 * A date in German. Standing alone it's "der zwölfte November" (the ordinal after der takes -e),
 * the weekday before it with a comma, the year after it: "Donnerstag, der zwölfte November
 * zweitausendsechsundzwanzig". Years before 2000 are said in hundreds (neunzehnhundertfünfzig).
 * Saying on which day it is takes am and -en: "am zwölften November". Written: "Donnerstag,
 * 12. November 2026".
 */

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

const say = (text: string, note?: string): Phrase => ({ text, ...(note ? { note } : {}) });

export function sayGermanDate(d: CalendarDate, parts: DateParts): DateSaying {
  if (!isValidDate(d)) throw new RangeError(`Not a date: ${d.year}-${d.month}-${d.day}`);
  const stem = germanOrdinalStem(d.day);
  const month = MONTHS[d.month - 1];
  const weekday = WEEKDAYS[weekdayOf(d)];
  const year = parts.year ? ` ${germanYear(d.year)}` : '';

  const everyday = `${parts.weekday ? `${weekday}, ` : ''}der ${stem}e ${month}${year}`;
  const on = `am ${parts.weekday ? `${weekday}, dem ` : ''}${stem}en ${month}${year}`;
  const asNumbers = `${parts.weekday ? `${weekday}, ` : ''}der ${stem}e ${germanOrdinalStem(d.month)}e${year}`;
  const also = [
    say(on, 'Saying on which day: am, and the ordinal ends in -en'),
    say(asNumbers, 'The month as a number too, as 12.11. is read out'),
  ];
  const written = `${parts.weekday ? `${weekday}, ` : ''}${d.day}. ${month}${parts.year ? ` ${d.year}` : ''}`;
  return { everyday: say(everyday), also: distinct([say(everyday), ...also]).slice(1), written: say(written) };
}
