import { type CalendarDate, type DateParts, type DateSaying, isValidDate, weekdayOf } from '../date';
import { distinct, type Phrase } from '../phrase';
import { frenchNumber } from './numbers';

/*
 * A date in French: the weekday, the day as a cardinal (the first is premier, written 1er), the
 * month and the year, all lowercase: jeudi douze novembre deux mille vingt-six. "le" before it is
 * how it's said inside a sentence. Years before 2000 are mille neuf cent...; dix-neuf cent... is
 * also heard.
 */

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const say = (text: string, note?: string): Phrase => (note ? { text, note } : { text });

/** 1900 to 1999 counted in hundreds: dix-neuf cent cinquante-huit. */
function hundredsYear(year: number): string {
  const rest = year % 100;
  return `${frenchNumber(Math.floor(year / 100))} cent${rest ? ` ${frenchNumber(rest)}` : ''}`;
}

export function sayFrenchDate(d: CalendarDate, parts: DateParts): DateSaying {
  if (!isValidDate(d)) throw new RangeError(`Not a date: ${d.year}-${d.month}-${d.day}`);
  const weekday = parts.weekday ? `${WEEKDAYS[weekdayOf(d)]} ` : '';
  const month = MONTHS[d.month - 1];
  const said = (day: string, year: string) => `${weekday}${day} ${month}${parts.year ? ` ${year}` : ''}`;
  const day = d.day === 1 ? 'premier' : frenchNumber(d.day);
  const everyday = said(day, frenchNumber(d.year));
  const also = [say(`le ${everyday}`, 'As it is said inside a sentence')];
  if (parts.year && d.year >= 1100 && d.year < 2000) also.push(say(said(day, hundredsYear(d.year)), 'Also heard for years before 2000'));
  const written = said(d.day === 1 ? '1er' : String(d.day), String(d.year));
  return { everyday: say(everyday), also: distinct([say(everyday), ...also]).slice(1), written: say(written) };
}
