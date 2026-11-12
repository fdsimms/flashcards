import { distinct, type Phrase } from '../phrase';
import type { ClockTime, TimeSaying } from '../time';
import { greekNumber } from './numbers';
import { greekRoman } from './translit';

/**
 * A time of day in Greek. Conversation uses the 12-hour clock, the hour feminine (μία, τρεις,
 * τέσσερις, agreeing with η ώρα): "και" past the hour up to the half (δύο και δέκα, δύο και
 * τέταρτο, δύο και μισή), then "παρά" to the next hour from :35 (τρεις παρά είκοσι πέντε, τρεις
 * παρά τέταρτο). :31 to :34 are said past the hour, read off the digits (δύο και τριάντα δύο), with
 * παρά as another way. On the hour it's the bare hour, or with "η ώρα"; noon and midnight are also
 * μεσημέρι and μεσάνυχτα. The formal 24-hour form is "δεκατέσσερις και τριάντα".
 */

const fem = (n: number) => greekNumber(n, 'feminine');
const neut = (n: number) => greekNumber(n, 'neuter');

/** The 12-hour hour for `h` (0 to 23): 0 and 12 are δώδεκα. */
function hour12(h: number): string {
  return fem(h % 12 || 12);
}

/** The part of the day a time falls in, said after it. */
function partOfDay(t: ClockTime): string {
  const h = t.hour;
  if (h === 0 && t.minute === 0) return 'τα μεσάνυχτα';
  if (h <= 4 || h === 23) return 'τη νύχτα';
  if (h <= 11) return 'το πρωί';
  if (h <= 13) return 'το μεσημέρι';
  if (h <= 17) return 'το απόγευμα';
  return 'το βράδυ';
}

const say = (text: string, note?: string): Phrase => ({ text, roman: greekRoman(text), ...(note ? { note } : {}) });

/** Minutes after και or παρά: τέταρτο for 15, μισή for 30. */
function minutes(m: number): string {
  return m === 15 ? 'τέταρτο' : m === 30 ? 'μισή' : neut(m);
}

/** The ways to say `t` in conversation, the usual one first; none carry the part of the day. */
function forms(t: ClockTime): string[] {
  const { hour: h, minute: m } = t;
  const now = hour12(h);
  const next = hour12(h + 1);
  if (m === 0) {
    const special = h === 0 ? ['μεσάνυχτα'] : h === 12 ? ['μεσημέρι'] : [];
    return [now, `${now} η ώρα`, ...special];
  }
  if (m <= 30) return [`${now} και ${minutes(m)}`];
  if (m < 35) return [`${now} και ${neut(m)}`, `${next} παρά ${minutes(60 - m)}`];
  return [`${next} παρά ${minutes(60 - m)}`];
}

export function sayGreekTime(t: ClockTime): TimeSaying {
  if (!(Number.isInteger(t.hour) && Number.isInteger(t.minute) && t.hour >= 0 && t.hour <= 23 && t.minute >= 0 && t.minute <= 59)) {
    throw new RangeError(`Not a time of day: ${t.hour}:${t.minute}`);
  }
  const [first, ...others] = forms(t);
  const everyday = say(first);
  const withPart = say(`${first} ${partOfDay(t)}`);
  const formalText = t.hour === 0 && t.minute === 0 ? 'μηδέν μηδέν'
    : t.minute ? `${fem(t.hour)} και ${neut(t.minute)}`
    : `${fem(t.hour)} μηδέν μηδέν`;
  return { everyday, also: distinct([everyday, withPart, ...others.map((x) => say(x))]).slice(1), formal: say(formalText) };
}
