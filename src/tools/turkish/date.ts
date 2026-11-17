import { type CalendarDate, type DateParts, type DateSaying, isValidDate, weekdayOf } from '../date';
import { type Phrase } from '../phrase';
import { turkishCardinal } from './numbers';

/**
 * A date in Turkish: the day as a plain number (not an ordinal), then the month, then the year as a
 * plain number, and the weekday last: "on iki Kasım iki bin yirmi altı Perşembe". Months and
 * weekdays are written with a capital. Written: "12 Kasım 2026 Perşembe".
 */

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const WEEKDAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

const say = (text: string): Phrase => ({ text });

export function sayTurkishDate(d: CalendarDate, parts: DateParts): DateSaying {
  if (!isValidDate(d)) throw new RangeError(`Not a date: ${d.year}-${d.month}-${d.day}`);
  const weekday = parts.weekday ? ` ${WEEKDAYS[weekdayOf(d)]}` : '';
  const month = MONTHS[d.month - 1];
  const everyday = say(`${turkishCardinal(d.day)} ${month}${parts.year ? ` ${turkishCardinal(d.year)}` : ''}${weekday}`);
  const written = say(`${d.day} ${month}${parts.year ? ` ${d.year}` : ''}${weekday}`);
  return { everyday, also: [], written };
}
