import { type CalendarDate, type DateParts, type DateSaying, isValidDate, weekdayOf } from '../date';
import { distinct, type Phrase } from '../phrase';
import { spanishNumber } from './numbers';

/*
 * A date in Spanish, as Mexico says it: the weekday, the day as a number (the first is primero),
 * de and the month, de and the year as a cardinal: jueves doce de noviembre de dos mil veintiséis.
 * Weekdays and months are lowercase. "el" before it is how it's said inside a sentence.
 */

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const say = (text: string, note?: string): Phrase => (note ? { text, note } : { text });

export function saySpanishDate(d: CalendarDate, parts: DateParts): DateSaying {
  if (!isValidDate(d)) throw new RangeError(`Not a date: ${d.year}-${d.month}-${d.day}`);
  const weekday = parts.weekday ? `${WEEKDAYS[weekdayOf(d)]} ` : '';
  const month = MONTHS[d.month - 1];
  const said = (day: string, year: string) => `${weekday}${day} de ${month}${parts.year ? ` de ${year}` : ''}`;
  const day = d.day === 1 ? 'primero' : spanishNumber(d.day);
  const everyday = said(day, spanishNumber(d.year));
  const also = [say(`el ${everyday}`, 'As it is said inside a sentence')];
  if (d.day === 1) also.push(say(said('uno', spanishNumber(d.year)), 'Also heard, more in Spain'));
  const written = said(String(d.day), String(d.year));
  return { everyday: say(everyday), also: distinct([say(everyday), ...also]).slice(1), written: say(written) };
}
