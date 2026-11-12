import { isValidDate, weekdayOf, type CalendarDate, type DateParts, type DateSaying } from '../date';
import type { Phrase } from '../phrase';
import { dayOrdinal, dayOrdinalGenitive, yearOrdinalGenitive } from './numbers';
import { russianTranslit } from './translit';

/**
 * A date in Russian. Standing alone the day is a neuter ordinal (число is understood) and the
 * month in the genitive: двенадцатое ноября. The year is a genitive ordinal before года: две тысячи
 * двадцать шестого года. "On" a date puts the day in the genitive too (двенадцатого ноября), and
 * the weekday after в in the accusative (в среду). Written: четверг, 12 ноября 2026 г.
 */

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
/** Sunday first, as weekdayOf counts. */
const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
/** "On" a weekday: в or во and the accusative. */
const ON_WEEKDAYS = ['в воскресенье', 'в понедельник', 'во вторник', 'в среду', 'в четверг', 'в пятницу', 'в субботу'];

const ON = 'Saying on which day';

function ru(text: string, note?: string): Phrase {
  return { text, roman: russianTranslit(text), ...(note ? { note } : {}) };
}

export function sayRussianDate(d: CalendarDate, parts: DateParts): DateSaying {
  if (!isValidDate(d)) throw new RangeError(`Not a date: ${d.year}-${d.month}-${d.day}`);
  const month = MONTHS_GEN[d.month - 1];
  const weekday = weekdayOf(d);
  const year = parts.year ? ` ${yearOrdinalGenitive(d.year)} года` : '';
  const said = (day: string, weekdayWords: string) => `${parts.weekday ? `${weekdayWords}, ` : ''}${day} ${month}${year}`;
  return {
    everyday: ru(said(dayOrdinal(d.day), WEEKDAYS[weekday])),
    also: [ru(said(dayOrdinalGenitive(d.day), ON_WEEKDAYS[weekday]), ON)],
    written: ru(`${parts.weekday ? `${WEEKDAYS[weekday]}, ` : ''}${d.day} ${month}${parts.year ? ` ${d.year} г.` : ''}`),
  };
}
