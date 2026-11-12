import type { Phrase } from './phrase';
import { pickOther } from './random';

/** A time of day for the Telling the time tool, picking one at random, and how a language says one. */

export interface ClockTime {
  /** 0 to 23. */
  hour: number;
  /** 0 to 59. */
  minute: number;
}

/** How a random time's minutes are picked: any minute, multiples of 5, quarter hours, or half hours. */
export type MinuteStep = 1 | 5 | 15 | 30;

export const MINUTE_STEPS: MinuteStep[] = [1, 5, 15, 30];

/**
 * A time at random, its minutes a multiple of `step`, and never `previous` again, so the
 * randomize button always changes the time. `random` is Math.random's shape, for tests.
 */
export function randomTime(step: MinuteStep, previous?: ClockTime, random: () => number = Math.random): ClockTime {
  const perHour = 60 / step;
  const slot = pickOther(24 * perHour, previous ? previous.hour * perHour + previous.minute / step : undefined, random);
  return { hour: Math.floor(slot / perHour), minute: (slot % perHour) * step };
}

/** 24-hour digits: 9:05 is "09:05". */
export function clockText(t: ClockTime): string {
  return `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;
}

/**
 * A time of day said in one language (each language's own time.ts makes one). No "it is" frame
 * (es son las, fr il est): just the time, as it would follow one, with Spanish's la/las kept since
 * the hour needs it.
 */
export interface TimeSaying {
  /** The usual way to say it in conversation, the one heard most; without the part of the day where the language leaves it off. */
  everyday: Phrase;
  /** Other ways heard for the same time (with the part of the day, regional forms), each with a note when it needs one. */
  also: Phrase[];
  /** The 24-hour form: what's written, announced, and read off a timetable. */
  formal: Phrase;
}
