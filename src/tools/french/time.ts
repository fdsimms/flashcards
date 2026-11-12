import { distinct, type Phrase } from '../phrase';
import type { ClockTime, TimeSaying } from '../time';
import { frenchNumber } from './numbers';

/**
 * A time of day in French. In conversation, the 12-hour clock: une heure, deux heures, midi and
 * minuit; et quart, et demie (et demi after midi and minuit), else the minutes, up to :39; from :40
 * the next hour moins the minutes left (trois heures moins le quart, moins dix), with deux heures
 * quarante as another way to say it, and moins already heard from :35. The part of the day (du
 * matin, de l'après-midi, du soir) is added when it isn't clear; never after midi or minuit. The
 * formal 24-hour form is what's written and announced: quatorze heures trente, zéro heure.
 */

/** The hour 0 to 23 on the 12-hour clock: minuit, une heure, midi, deux heures. */
function hourName(h: number): string {
  if (h === 0) return 'minuit';
  if (h === 12) return 'midi';
  const h12 = h % 12;
  return `${frenchNumber(h12, true)} heure${h12 > 1 ? 's' : ''}`;
}

/** The part of the day `h` falls in: the hour that's named, so 17:40 (six heures moins vingt) is du soir. */
function partOfDay(h: number): string {
  if (h < 12) return 'du matin';
  if (h < 18) return "de l'après-midi";
  return 'du soir';
}

const say = (text: string): Phrase => ({ text });

export function sayFrenchTime(t: ClockTime): TimeSaying {
  const { hour: h, minute: m } = t;
  if (!(Number.isInteger(h) && Number.isInteger(m) && h >= 0 && h <= 23 && m >= 0 && m <= 59)) throw new RangeError(`Not a time of day: ${h}:${m}`);
  const nextH = (h + 1) % 24;
  const hour = hourName(h);
  const next = hourName(nextH);
  const midiOrMinuit = (x: number) => x === 0 || x === 12;
  const past = () => m === 15 ? 'et quart' : m === 30 ? (midiOrMinuit(h) ? 'et demi' : 'et demie') : frenchNumber(m, true);
  const toNext = () => (m === 45 ? 'moins le quart' : `moins ${frenchNumber(60 - m, true)}`);
  /** `said` with the part of the day after it, unless its hour is midi or minuit. */
  const withPart = (said: string, spokenHour: number) => (midiOrMinuit(spokenHour) ? said : `${said} ${partOfDay(spokenHour)}`);

  let everyday: string;
  const also: string[] = [];
  if (m === 0) {
    everyday = hour;
    also.push(withPart(hour, h));
  } else if (m < 40) {
    everyday = `${hour} ${past()}`;
    also.push(withPart(everyday, h));
    if (m >= 35) also.push(`${next} ${toNext()}`);
  } else {
    everyday = `${next} ${toNext()}`;
    also.push(withPart(everyday, nextH), `${hour} ${frenchNumber(m, true)}`);
  }

  const formalHour = h === 0 ? 'zéro heure' : `${frenchNumber(h, true)} heure${h > 1 ? 's' : ''}`;
  const formal = m === 0 ? formalHour : `${formalHour} ${frenchNumber(m, true)}`;
  return { everyday: say(everyday), also: distinct([everyday, ...also].map(say)).slice(1), formal: say(formal) };
}
