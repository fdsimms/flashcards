import { type CalendarDate, type DateParts, type DateSaying, isValidDate, weekdayOf } from '../date';
import { distinct, phrase, type Phrase, type Word } from '../phrase';
import { gatsuWord, nenWord, nichiWord } from './numbers';

/*
 * A date in Japanese, largest first: the year, the month, the day, then the weekday (2026年11月13日
 * 金曜日). The days of the month have their own readings up to ten (ついたち, ふつか... とおか), and
 * 14, 20 and 24 (じゅうよっか, はつか). The weekday is shortened to 金曜 in speech, and the year is
 * also counted in the emperor's era: 令和 from 1 May 2019, 平成 from 8 January 1989, 昭和 before,
 * its first year 元年. Written with digits, the weekday as one kanji in parentheses: 2026年11月13日（金）.
 */

/** Sunday first, as `weekdayOf` counts: the full name, the short one, and the one kanji written. */
const WEEKDAYS: [full: Word, short: Word, kanji: string][] = [
  [['日曜日', 'にちようび'], ['日曜', 'にちよう'], '日'],
  [['月曜日', 'げつようび'], ['月曜', 'げつよう'], '月'],
  [['火曜日', 'かようび'], ['火曜', 'かよう'], '火'],
  [['水曜日', 'すいようび'], ['水曜', 'すいよう'], '水'],
  [['木曜日', 'もくようび'], ['木曜', 'もくよう'], '木'],
  [['金曜日', 'きんようび'], ['金曜', 'きんよう'], '金'],
  [['土曜日', 'どようび'], ['土曜', 'どよう'], '土'],
];

/** The eras a year from 1950 on falls in, latest first: its name and the date it began. */
const ERAS: { name: Word; start: CalendarDate }[] = [
  { name: ['令和', 'れいわ'], start: { year: 2019, month: 5, day: 1 } },
  { name: ['平成', 'へいせい'], start: { year: 1989, month: 1, day: 8 } },
  { name: ['昭和', 'しょうわ'], start: { year: 1926, month: 12, day: 25 } },
];

const onOrAfter = (d: CalendarDate, s: CalendarDate) =>
  d.year !== s.year ? d.year > s.year : d.month !== s.month ? d.month > s.month : d.day >= s.day;

/** The era and its year on `d`: 令和8年 for 13 November 2026. */
export function eraOf(d: CalendarDate): { name: Word; year: number } {
  const era = ERAS.find((e) => onOrAfter(d, e.start)) ?? ERAS[ERAS.length - 1];
  return { name: era.name, year: d.year - era.start.year + 1 };
}

/** An era's year: 元年 for its first, else the year with 年. */
const eraYear = (y: number): Word => (y === 1 ? ['元年', 'がんねん'] : nenWord(y));

/** Words set apart by spaces in the reading, as the parts of a date are said. */
function said(words: Word[], note?: string): Phrase {
  return phrase(words, '', note);
}

export function sayJapaneseDate(d: CalendarDate, parts: DateParts): DateSaying {
  if (!isValidDate(d)) throw new RangeError(`Not a date: ${d.year}-${d.month}-${d.day}`);
  const [weekday, weekdayShort, weekdayKanji] = WEEKDAYS[weekdayOf(d)];
  const dayAndMonth = [gatsuWord(d.month), nichiWord(d.day)];
  const era = eraOf(d);
  const year = parts.year ? [nenWord(d.year)] : [];

  const everyday = said([...year, ...dayAndMonth, ...(parts.weekday ? [weekday] : [])]);
  const also: Phrase[] = [];
  if (parts.weekday) also.push(said([...year, ...dayAndMonth, weekdayShort], 'Shortened, as it is said in conversation'));
  if (parts.year) {
    also.push(said([era.name, eraYear(era.year), ...dayAndMonth, ...(parts.weekday ? [weekday] : [])], `The year of the era (${era.name[0]})`));
  }
  const written = {
    text: `${parts.year ? `${d.year}年` : ''}${d.month}月${d.day}日${parts.weekday ? `（${weekdayKanji}）` : ''}`,
  };
  return { everyday, also: distinct([everyday, ...also]).slice(1), written };
}
