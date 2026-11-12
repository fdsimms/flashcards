import { type CalendarDate, type DateParts, type DateSaying, isValidDate, weekdayOf } from '../date';
import { distinct, type Phrase } from '../phrase';
import { greekCardinal, greekNumber } from './numbers';
import { greekRoman } from './translit';

/**
 * A date in Greek: the day as a feminine cardinal (η ημέρα), the first of the month πρώτη, then
 * the month in the genitive, the weekday before them with a comma and the year after, said as a
 * plain number: "Πέμπτη, δώδεκα Νοεμβρίου δύο χιλιάδες είκοσι έξι". In speech the month is often
 * its everyday name with του (δώδεκα του Νοέμβρη). Saying on which day: "στις δώδεκα Νοεμβρίου",
 * "την πρώτη Νοεμβρίου". Written: "Πέμπτη 12 Νοεμβρίου 2026".
 */

const MONTHS = ['Ιανουαρίου', 'Φεβρουαρίου', 'Μαρτίου', 'Απριλίου', 'Μαΐου', 'Ιουνίου', 'Ιουλίου', 'Αυγούστου', 'Σεπτεμβρίου', 'Οκτωβρίου', 'Νοεμβρίου', 'Δεκεμβρίου'];
/** The months' everyday names, after του. */
const SPOKEN_MONTHS = ['Γενάρη', 'Φλεβάρη', 'Μάρτη', 'Απρίλη', 'Μάη', 'Ιούνη', 'Ιούλη', 'Αυγούστου', 'Σεπτέμβρη', 'Οκτώβρη', 'Νοέμβρη', 'Δεκέμβρη'];
const WEEKDAYS = ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'];

const say = (text: string, note?: string): Phrase => ({ text, roman: greekRoman(text), ...(note ? { note } : {}) });

/** The day of the month in words: πρώτη, then feminine cardinals (τρεις, είκοσι μία). */
function dayWords(day: number): string {
  return day === 1 ? 'πρώτη' : greekNumber(day, 'feminine');
}

export function sayGreekDate(d: CalendarDate, parts: DateParts): DateSaying {
  if (!isValidDate(d)) throw new RangeError(`Not a date: ${d.year}-${d.month}-${d.day}`);
  const weekday = parts.weekday ? `${WEEKDAYS[weekdayOf(d)]}, ` : '';
  const year = parts.year ? ` ${greekCardinal(d.year)}` : '';
  const day = dayWords(d.day);
  const everyday = say(`${weekday}${day} ${MONTHS[d.month - 1]}${year}`);
  const also = [
    say(`${weekday}${day} του ${SPOKEN_MONTHS[d.month - 1]}${year}`, 'The month by its everyday name'),
    say(`${weekday}${d.day === 1 ? 'την' : 'στις'} ${day} ${MONTHS[d.month - 1]}${year}`, 'Saying on which day'),
  ];
  const written = say(`${parts.weekday ? `${WEEKDAYS[weekdayOf(d)]} ` : ''}${d.day} ${MONTHS[d.month - 1]}${parts.year ? ` ${d.year}` : ''}`);
  return { everyday, also: distinct([everyday, ...also]).slice(1), written };
}
