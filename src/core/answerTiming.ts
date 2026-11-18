/**
 * Review's answer timing (the ⋯ menu's Show answer timing): how long after an answer button is
 * pressed the next card is on screen, how long rebuilding the queue took, and when the answer
 * was saved. Measured on the phone, in the build in use, so a slow step shows which it is.
 */

/** One answer's timings, in milliseconds. */
export interface AnswerTiming {
  /** From the press to the next card on screen (a template card's page loaded). */
  shown?: number;
  /** How long rebuilding the queue took, whenever it ran. */
  queue?: number;
  /** From the press to the answer written to the database and the kept Anki collection. */
  saved?: number;
}

/** How many answers "usually" is worked out over. */
export const TIMING_SAMPLES = 20;

/** The middle value (the mean of the middle two for an even count); undefined for none. */
export function median(values: readonly number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The latest `shown` times, newest last, at most `TIMING_SAMPLES`. */
export function withSample(recent: readonly number[], shown: number): number[] {
  return [...recent, shown].slice(-TIMING_SAMPLES);
}

/**
 * The line Review shows: "Card shown: 48 ms (usually 52). Queue: 61 ms. Saved: 140 ms." Each part
 * appears once it's known; "usually" once three answers have been timed. Null before the first.
 */
export function timingLine(latest: AnswerTiming | undefined, recentShown: readonly number[]): string | null {
  if (!latest) return null;
  const ms = (v: number) => `${Math.round(v)} ms`;
  const usual = recentShown.length >= 3 ? median(recentShown) : undefined;
  const parts = [
    latest.shown !== undefined ? `Card shown: ${ms(latest.shown)}${usual !== undefined ? ` (usually ${Math.round(usual)})` : ''}.` : null,
    latest.queue !== undefined ? `Queue: ${ms(latest.queue)}.` : null,
    latest.saved !== undefined ? `Saved: ${ms(latest.saved)}.` : null,
  ].filter((p): p is string => p !== null);
  return parts.length ? parts.join(' ') : null;
}
