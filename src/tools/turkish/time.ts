import { distinct, type Phrase } from '../phrase';
import type { ClockTime, TimeSaying } from '../time';
import { turkishNumber } from './numbers';

/**
 * A time of day in Turkish. Conversation uses the 12-hour clock with "saat" before it: saat üç (3:00),
 * saat üç buçuk (3:30, buçuk is a half). Minutes past an hour are the hour in the accusative, the
 * minutes and geçiyor: saat üçü beş geçiyor (3:05), üçü çeyrek geçiyor (3:15, çeyrek is a quarter).
 * Minutes to the next hour are that hour in the dative, the minutes and var: saat dörde beş var
 * (3:55), dörde çeyrek var (3:45). The hour and the minutes read out as numbers are heard as much
 * (saat üç kırk beş). The part of the day goes first (akşam saat yedi buçuk). The formal 24-hour form
 * reads the numbers: saat on dört otuz, on dört sıfır beş.
 */

// An hour's number with the endings it takes, 1 to 12, as vowel harmony and the final consonant
// require: dört becomes dördü and dörde, altı altıyı and altıya.
const ACCUSATIVE = ['', 'biri', 'ikiyi', 'üçü', 'dördü', 'beşi', 'altıyı', 'yediyi', 'sekizi', 'dokuzu', 'onu', 'on biri', 'on ikiyi'];
const DATIVE = ['', 'bire', 'ikiye', 'üçe', 'dörde', 'beşe', 'altıya', 'yediye', 'sekize', 'dokuza', 'ona', 'on bire', 'on ikiye'];

/** The 12-hour hour for `h` (0 to 23): 0 and 12 are on iki. */
const hour12 = (h: number) => h % 12 || 12;

/** The part of the day a time falls in, said before it. */
function partOfDay(h: number): string {
  if (h <= 4 || h >= 22) return 'gece';
  if (h <= 11) return 'sabah';
  if (h === 12) return 'öğlen';
  if (h <= 17) return 'öğleden sonra';
  return 'akşam';
}

/** The ways to say `t` in conversation, the usual one first; none carries the part of the day. */
function forms(t: ClockTime): Phrase[] {
  const { hour: h, minute: m } = t;
  const now = hour12(h);
  const next = hour12(h + 1);
  const minutes = (n: number) => (n === 15 ? 'çeyrek' : turkishNumber(n));
  if (m === 0) return h === 0 ? [{ text: `saat ${turkishNumber(now)}` }, { text: 'gece yarısı' }] : h === 12 ? [{ text: `saat ${turkishNumber(now)}` }, { text: 'öğlen' }] : [{ text: `saat ${turkishNumber(now)}` }];
  if (m === 30) return [{ text: `saat ${turkishNumber(now)} buçuk` }];
  if (m < 30) return [{ text: `saat ${ACCUSATIVE[now]} ${minutes(m)} geçiyor` }];
  return [{ text: `saat ${DATIVE[next]} ${minutes(60 - m)} var` }];
}

export function sayTurkishTime(t: ClockTime): TimeSaying {
  if (!(Number.isInteger(t.hour) && Number.isInteger(t.minute) && t.hour >= 0 && t.hour <= 23 && t.minute >= 0 && t.minute <= 59)) {
    throw new RangeError(`Not a time of day: ${t.hour}:${t.minute}`);
  }
  const [everyday, ...others] = forms(t);
  const withPart = { text: `${partOfDay(t.hour)} ${everyday.text}` };
  const bare = { text: everyday.text.replace(/^saat /, '') };
  const read = t.minute ? { text: `saat ${turkishNumber(hour12(t.hour))} ${turkishNumber(t.minute)}`, note: 'The hour and the minutes, as numbers' } : undefined;
  const n = turkishNumber;
  const minuteWords = t.minute < 10 ? `sıfır ${n(t.minute)}` : n(t.minute);
  const formal = { text: t.minute ? `saat ${n(t.hour)} ${minuteWords}` : t.hour === 0 ? 'saat sıfır sıfır' : `saat ${n(t.hour)}` };
  return { everyday, also: distinct([everyday, withPart, bare, ...(read ? [read] : []), ...others]).slice(1), formal };
}
