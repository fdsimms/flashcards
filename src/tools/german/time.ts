import { distinct, type Phrase } from '../phrase';
import type { ClockTime, TimeSaying } from '../time';
import { germanNumber } from './numbers';

/**
 * A time of day in German. Conversation uses the 12-hour clock, counting from the hour before
 * (zehn nach zwei) up to 20 past, then around the half hour, which belongs to the hour coming
 * (fünf vor halb drei, halb drei, zehn nach halb drei), then to the hour coming (Viertel vor
 * drei). 20 past and 20 to are said both ways. On the hour it's "zwei Uhr" (one o'clock is
 * "ein Uhr"; without Uhr, "eins"). East and south Germany and Austria also say "viertel drei"
 * for 2:15 and "dreiviertel drei" for 2:45. The formal 24-hour form is "vierzehn Uhr dreißig".
 */

const REGIONAL = 'In eastern and southern Germany and Austria';

/** The 12-hour hour for `h` (0 to 23): 0 and 12 are zwölf. */
function hour12(h: number): string {
  return germanNumber(h % 12 || 12);
}

/** The part of the day a time falls in, said after it. */
function partOfDay(h: number): string {
  if (h <= 4 || h === 23) return 'nachts';
  if (h <= 8) return 'morgens';
  if (h <= 11) return 'vormittags';
  if (h <= 13) return 'mittags';
  if (h <= 17) return 'nachmittags';
  return 'abends';
}

const plain = (text: string, note?: string): Phrase => (note ? { text, note } : { text });

/** The ways to say `t` in conversation, the usual one first; none carry the part of the day. */
function forms(t: ClockTime): Phrase[] {
  const { hour: h, minute: m } = t;
  const now = hour12(h);
  const next = hour12(h + 1);
  const n = germanNumber;
  if (m === 0) {
    const uhr = `${h % 12 === 1 ? 'ein' : now} Uhr`;
    const special = h === 0 ? ['Mitternacht'] : h === 12 ? ['Mittag'] : [];
    return [uhr, now, ...special].map((x) => plain(x));
  }
  if (m === 15) return [plain(`Viertel nach ${now}`), plain(`viertel ${next}`, REGIONAL)];
  if (m === 45) return [plain(`Viertel vor ${next}`), plain(`dreiviertel ${next}`, REGIONAL)];
  if (m === 30) return [plain(`halb ${next}`)];
  if (m < 20) return [plain(`${n(m)} nach ${now}`)];
  if (m === 20) return [plain(`zwanzig nach ${now}`), plain(`zehn vor halb ${next}`)];
  if (m < 30) return [plain(`${n(30 - m)} vor halb ${next}`), plain(`${n(m)} nach ${now}`)];
  if (m < 40) return [plain(`${n(m - 30)} nach halb ${next}`)];
  if (m === 40) return [plain(`zwanzig vor ${next}`), plain(`zehn nach halb ${next}`)];
  return [plain(`${n(60 - m)} vor ${next}`)];
}

export function sayGermanTime(t: ClockTime): TimeSaying {
  if (!(Number.isInteger(t.hour) && Number.isInteger(t.minute) && t.hour >= 0 && t.hour <= 23 && t.minute >= 0 && t.minute <= 59)) {
    throw new RangeError(`Not a time of day: ${t.hour}:${t.minute}`);
  }
  const [everyday, ...others] = forms(t);
  const withPart = { text: `${everyday.text} ${partOfDay(t.hour)}` };
  const hourWord = t.hour === 1 ? 'ein' : germanNumber(t.hour);
  const formal = { text: t.minute ? `${hourWord} Uhr ${germanNumber(t.minute)}` : `${hourWord} Uhr` };
  return { everyday, also: distinct([everyday, withPart, ...others]).slice(1), formal };
}
