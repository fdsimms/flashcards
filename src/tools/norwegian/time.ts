import { distinct, type Phrase } from '../phrase';
import type { ClockTime, TimeSaying } from '../time';
import { norwegianNumber } from './numbers';

/**
 * A time of day in Norwegian (Bokmål). Conversation uses the 12-hour clock: minutes over the hour
 * up to 20 past (ti over to, kvart over to), then around the half hour, which belongs to the hour
 * coming (ti på halv tre for 2:20, halv tre, ti over halv tre for 2:40), then minutes to the next
 * hour (kvart på tre). Minutes that aren't a multiple of five take "minutter" (sju minutter over
 * to), one "ett minutt". One o'clock is "ett". The formal 24-hour form reads the digits:
 * "fjorten tretti", "fjorten null fem", and on the hour "klokka fjorten".
 */

/** The 12-hour hour for `h` (0 to 23): 0 and 12 are tolv, one o'clock ett. */
function hour12(h: number): string {
  const n = h % 12 || 12;
  return n === 1 ? 'ett' : norwegianNumber(n);
}

/** The part of the day a time falls in, said after it. */
function partOfDay(h: number): string {
  if (h <= 4 || h === 23) return 'om natta';
  if (h <= 9) return 'om morgenen';
  if (h <= 11) return 'på formiddagen';
  if (h <= 13) return 'midt på dagen';
  if (h <= 17) return 'på ettermiddagen';
  return 'om kvelden';
}

/** A count of minutes before over/på: bare in fives, else with minutter. */
function minutes(m: number): string {
  if (m === 1) return 'ett minutt';
  return m % 5 === 0 ? norwegianNumber(m) : `${norwegianNumber(m)} minutter`;
}

/** The ways to say `t` in conversation, the usual one first; none carry the part of the day. */
function forms(t: ClockTime): Phrase[] {
  const { hour: h, minute: m } = t;
  const now = hour12(h);
  const next = hour12(h + 1);
  if (m === 0) return h === 0 ? [{ text: now }, { text: 'midnatt' }] : [{ text: now }];
  if (m === 15) return [{ text: `kvart over ${now}` }];
  if (m === 45) return [{ text: `kvart på ${next}` }];
  if (m === 30) return [{ text: `halv ${next}` }];
  if (m < 20) return [{ text: `${minutes(m)} over ${now}` }];
  if (m < 30) return [{ text: `${minutes(30 - m)} på halv ${next}` }];
  if (m <= 40) return [{ text: `${minutes(m - 30)} over halv ${next}` }];
  return [{ text: `${minutes(60 - m)} på ${next}` }];
}

export function sayNorwegianTime(t: ClockTime): TimeSaying {
  if (!(Number.isInteger(t.hour) && Number.isInteger(t.minute) && t.hour >= 0 && t.hour <= 23 && t.minute >= 0 && t.minute <= 59)) {
    throw new RangeError(`Not a time of day: ${t.hour}:${t.minute}`);
  }
  const [everyday, ...others] = forms(t);
  const withPart = { text: `${everyday.text} ${partOfDay(t.hour)}` };
  const n = norwegianNumber;
  const hourDigits = t.hour === 0 ? 'null null' : n(t.hour);
  const minuteDigits = t.minute < 10 ? `null ${n(t.minute)}` : n(t.minute);
  // On the hour, one o'clock is "klokka ett", as it's said; read as digits it's "en".
  const formal = { text: t.minute ? `${hourDigits} ${minuteDigits}` : `klokka ${t.hour === 1 ? 'ett' : hourDigits}` };
  return { everyday, also: distinct([everyday, withPart, ...others]).slice(1), formal };
}
