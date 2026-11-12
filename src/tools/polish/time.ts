import { distinct, type Phrase } from '../phrase';
import type { ClockTime, TimeSaying } from '../time';
import { hourOrdinal, hourOrdinalOblique, polishNumber } from './numbers';

/**
 * A time of day in Polish, on the 12-hour clock, the hour as a feminine ordinal (godzina): druga
 * (2:00). Minutes past take po and the hour in the locative: dziesięć po drugiej, kwadrans po
 * drugiej. Half past counts toward the next hour: wpół do trzeciej (2:30). After half past, za and
 * the minutes left, then the next hour: za dziesięć trzecia, za kwadrans trzecia. The part of the
 * day follows: w nocy, rano, przed południem, po południu, wieczorem. The formal form is the
 * 24-hour one: czternasta trzydzieści.
 */

const DIGITAL = 'As read off a digital clock';
const FROM_HALF = 'Counted from half past';

const say = (text: string, note?: string): Phrase => ({ text, ...(note ? { note } : {}) });

/** w nocy 23-4, rano 5-9, przed południem 10-11, po południu 12-17, wieczorem 18-22; noon itself is w południe. */
function partOfDay(t: ClockTime): string {
  if (t.hour === 12 && t.minute === 0) return 'w południe';
  if (t.hour >= 23 || t.hour < 5) return 'w nocy';
  if (t.hour < 10) return 'rano';
  if (t.hour < 12) return 'przed południem';
  if (t.hour < 18) return 'po południu';
  return 'wieczorem';
}

/** Minutes as a number of them, past the hour: minuta, dwie, dwadzieścia jeden. */
function minutesPast(m: number): string {
  return m === 1 ? 'minuta' : polishNumber(m, true);
}

/** Minutes left, after za: minutę, dwie, dziesięć. */
function minutesLeft(k: number): string {
  return k === 1 ? 'minutę' : polishNumber(k, true);
}

/** Minutes read as digits: trzydzieści pięć, dwadzieścia dwie, and after a leading zero plain digits: zero pięć, zero dwa. */
function minuteDigits(m: number): string {
  return m < 10 ? `zero ${polishNumber(m)}` : polishNumber(m, true);
}

export function sayPolishTime(t: ClockTime): TimeSaying {
  if (!(Number.isInteger(t.hour) && Number.isInteger(t.minute) && t.hour >= 0 && t.hour <= 23 && t.minute >= 0 && t.minute <= 59)) {
    throw new RangeError(`Not a time of day: ${t.hour}:${t.minute}`);
  }
  const m = t.minute;
  const h12 = t.hour % 12 || 12;
  const next = (h12 % 12) + 1;

  let everyday: string;
  const alts: Phrase[] = [];
  if (m === 0) {
    everyday = hourOrdinal(h12);
    if (t.hour === 12) alts.push(say('południe'));
    if (t.hour === 0) alts.push(say('północ'));
  } else if (m === 30) {
    everyday = `wpół do ${hourOrdinalOblique(next)}`;
  } else if (m === 15) {
    everyday = `kwadrans po ${hourOrdinalOblique(h12)}`;
    alts.push(say(`piętnaście po ${hourOrdinalOblique(h12)}`));
  } else if (m === 45) {
    everyday = `za kwadrans ${hourOrdinal(next)}`;
    alts.push(say(`za piętnaście ${hourOrdinal(next)}`));
  } else if (m < 30) {
    everyday = `${minutesPast(m)} po ${hourOrdinalOblique(h12)}`;
    if (m === 20 || m === 25) alts.push(say(`za ${minutesLeft(30 - m)} wpół do ${hourOrdinalOblique(next)}`, FROM_HALF));
  } else {
    everyday = `za ${minutesLeft(60 - m)} ${hourOrdinal(next)}`;
    if (m === 35 || m === 40) alts.push(say(`${minutesPast(m - 30)} po wpół do ${hourOrdinalOblique(next)}`, FROM_HALF));
  }
  if (m > 0) alts.push(say(`${hourOrdinal(h12)} ${minuteDigits(m)}`, DIGITAL));

  // Midnight is 24 on a timetable (do dwudziestej czwartej); a minute past it is zero.
  const hour24 = t.hour === 0 ? (m === 0 ? hourOrdinal(24) : 'zero') : hourOrdinal(t.hour);
  const formal = say(m === 0 ? hour24 : `${hour24} ${minuteDigits(m)}`);
  const formalAlt = m === 0 && t.hour !== 0 ? [say(`${hour24} zero zero`)] : [];

  const first = say(everyday);
  const also = distinct([first, say(`${everyday} ${partOfDay(t)}`), ...alts, ...formalAlt]).slice(1);
  return { everyday: first, also, formal };
}
