import { type CalendarDate, type DateParts, type DateSaying, isValidDate, weekdayOf } from '../date';
import { distinct, type Phrase } from '../phrase';
import { norwegianNumber, norwegianOrdinal } from './numbers';

/**
 * A date in Norwegian (Bokmål): the ordinal day, then the month in lower case, the weekday before
 * them and the year after: "torsdag tolvte november totusenogtjueseks". "den" before the day is
 * heard as much ("torsdag den tolvte november"). A year is one word: before 2000 in hundreds
 * (nittenhundreogfemti), shortened in speech to nittenfemti; from 2000 in thousands
 * (totusenogtjueseks), with tjuetjueseks heard from some for 2010 on. Written: "torsdag 12. november 2026".
 */

const MONTHS = ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember'];
const WEEKDAYS = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];

const say = (text: string, note?: string): Phrase => ({ text, ...(note ? { note } : {}) });

/** A year in words, as Norwegian says it: nittenhundreogfemti, totusen, totusenogtjueseks. */
export function norwegianYear(year: number): string {
  if (!Number.isInteger(year) || year < 1000 || year > 2999) throw new RangeError(`Not a year from 1000 to 2999: ${year}`);
  const rest = year % 100;
  if (year < 2000) return `${norwegianNumber(Math.floor(year / 100))}hundre${rest ? `og${norwegianNumber(rest)}` : ''}`;
  const afterThousands = year % 1000;
  const hundreds = Math.floor(afterThousands / 100);
  return `${norwegianNumber(Math.floor(year / 1000))}tusen${hundreds ? `${hundreds === 1 ? 'ett' : norwegianNumber(hundreds)}hundre` : ''}${rest ? `og${norwegianNumber(rest)}` : ''}`;
}

/** The shorter year heard in speech, two numbers run together, when there is one: nittenfemti, tjuetjueseks. */
function shortYear(year: number): string | undefined {
  const rest = year % 100;
  if (year >= 1100 && year < 2000 && rest >= 10) return `${norwegianNumber(Math.floor(year / 100))}${norwegianNumber(rest)}`;
  if (year >= 2010 && year < 2100) return `tjue${norwegianNumber(rest)}`;
  return undefined;
}

export function sayNorwegianDate(d: CalendarDate, parts: DateParts): DateSaying {
  if (!isValidDate(d)) throw new RangeError(`Not a date: ${d.year}-${d.month}-${d.day}`);
  const weekday = parts.weekday ? `${WEEKDAYS[weekdayOf(d)]} ` : '';
  const dayMonth = `${norwegianOrdinal(d.day)} ${MONTHS[d.month - 1]}`;
  const withYear = (y: string | undefined) => (parts.year && y ? ` ${y}` : '');
  const year = withYear(norwegianYear(d.year));

  const everyday = say(`${weekday}${dayMonth}${year}`);
  const also = [say(`${weekday}den ${dayMonth}${year}`)];
  const short = parts.year ? shortYear(d.year) : undefined;
  if (short) also.push(say(`${weekday}${dayMonth} ${short}`, d.year < 2000 ? 'The year shortened, as it often is in speech' : 'The year shortened, as some say it'));
  const written = say(`${weekday}${d.day}. ${MONTHS[d.month - 1]}${parts.year ? ` ${d.year}` : ''}`);
  return { everyday, also: distinct([everyday, ...also]).slice(1), written };
}
