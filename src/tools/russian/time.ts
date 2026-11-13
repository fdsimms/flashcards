import { distinct, type Phrase } from '../phrase';
import type { ClockTime, TimeSaying } from '../time';
import { countForm, russianNumber, russianNumberGenitive } from './numbers';
import { russianTranslit } from './translit';

/**
 * A time of day in Russian, on the 12-hour clock. Minutes past count toward the next hour, in the
 * genitive of its ordinal: десять минут третьего (2:10), четверть третьего (2:15), половина
 * третьего (2:30). Just after it the clock is read as it shows (два тридцать две, 2:32); from 2:35,
 * без and the minutes left in the genitive, then the next hour
 * as a bare number: без десяти три (2:50), без четверти три (2:45); one o'clock is час (без
 * десяти час). The part of the day follows in the genitive: ночи, утра, дня, вечера. The formal
 * form is the 24-hour one: четырнадцать тридцать.
 */

/** The genitive ordinal of an hour, 1 to 12: третьего. */
const ORDINAL_GENITIVE = ['', 'первого', 'второго', 'третьего', 'четвёртого', 'пятого', 'шестого', 'седьмого', 'восьмого', 'девятого', 'десятого', 'одиннадцатого', 'двенадцатого'];

const COLLOQUIAL = 'Colloquial';
const DIGITAL = 'As read off a digital clock';

function ru(text: string, note?: string): Phrase {
  return { text, roman: russianTranslit(text), ...(note ? { note } : {}) };
}

/** ночи 0-3, утра 4-11, дня 12-16, вечера 17-23. */
function partOfDay(hour: number): string {
  if (hour < 4) return 'ночи';
  if (hour < 12) return 'утра';
  if (hour < 17) return 'дня';
  return 'вечера';
}

/** An hour on the hour: час, два часа, пять часов. */
function hours(h: number): string {
  return h === 1 ? 'час' : `${russianNumber(h)} ${countForm(h, 'час', 'часа', 'часов')}`;
}

/** An hour as a bare number, after без: три, or час for one. */
function bareHour(h: number): string {
  return h === 1 ? 'час' : russianNumber(h);
}

/** Minutes read as digits: тридцать пять, ноль пять. */
function minuteDigits(m: number): string {
  return m < 10 ? `ноль ${russianNumber(m, 'f')}` : russianNumber(m, 'f');
}

/** Minutes past: десять минут, одна минута, две минуты. */
function minutesPast(m: number): string {
  return `${russianNumber(m, 'f')} ${countForm(m, 'минута', 'минуты', 'минут')}`;
}

/** Minutes left, after без: пяти and двадцати (a multiple of 5 drops минут), двух минут, одной минуты. */
function minutesLeft(k: number): string {
  const n = russianNumberGenitive(k, 'f');
  return k % 5 === 0 ? n : `${n} ${countForm(k, 'минуты', 'минут', 'минут')}`;
}

export function sayRussianTime(t: ClockTime): TimeSaying {
  if (!(Number.isInteger(t.hour) && Number.isInteger(t.minute) && t.hour >= 0 && t.hour <= 23 && t.minute >= 0 && t.minute <= 59)) {
    throw new RangeError(`Not a time of day: ${t.hour}:${t.minute}`);
  }
  const m = t.minute;
  const h12 = t.hour % 12 || 12;
  const next = (h12 % 12) + 1;
  const part = partOfDay(t.hour);

  let everyday: string;
  const alts: Phrase[] = [];
  if (m === 0) {
    everyday = hours(h12);
    if (t.hour === 12) alts.push(ru('полдень'));
    if (t.hour === 0) alts.push(ru('полночь'));
  } else if (m === 30) {
    everyday = `половина ${ORDINAL_GENITIVE[next]}`;
    alts.push(ru(`пол${ORDINAL_GENITIVE[next]}`, COLLOQUIAL));
  } else if (m === 15) {
    everyday = `четверть ${ORDINAL_GENITIVE[next]}`;
    alts.push(ru(`${minutesPast(15)} ${ORDINAL_GENITIVE[next]}`));
  } else if (m === 45) {
    everyday = `без четверти ${bareHour(next)}`;
    alts.push(ru(`без пятнадцати ${bareHour(next)}`));
  } else if (m < 30) {
    everyday = `${minutesPast(m)} ${ORDINAL_GENITIVE[next]}`;
  } else if (m < 35) {
    // Just past half, the clock is read as it shows: без двадцати девяти минут is rarely heard.
    everyday = `${bareHour(h12)} ${minuteDigits(m)}`;
    alts.push(ru(`без ${minutesLeft(60 - m)} ${bareHour(next)}`));
  } else {
    everyday = `без ${minutesLeft(60 - m)} ${bareHour(next)}`;
  }
  if (m > 0) alts.push(ru(`${bareHour(h12)} ${minuteDigits(m)}`, DIGITAL));

  const hour24 = t.hour === 0 ? 'ноль' : russianNumber(t.hour);
  const hourCount = `${hour24} ${countForm(t.hour, 'час', 'часа', 'часов')}`;
  const formal = m === 0 ? ru(hourCount) : ru(`${hour24} ${minuteDigits(m)}`);
  const formalAlt = m === 0 ? (t.hour === 0 ? [] : [ru(`${hour24} ноль-ноль`)]) : [ru(`${hourCount} ${minutesPast(m)}`)];

  const first = ru(everyday);
  const also = distinct([first, ru(`${everyday} ${part}`), ...alts, ...formalAlt]).slice(1);
  return { everyday: first, also, formal };
}
