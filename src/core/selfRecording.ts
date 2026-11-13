/**
 * Record yourself: a take of your own voice, kept only until the card or line it was made for
 * changes, to play next to the native recording. Never saved to the deck, synced or sent.
 */

/** A take stops by itself after this long, so a forgotten Stop doesn't record on and on. */
export const TAKE_LIMIT_SECONDS = 30;

/** How long a take has been recording, as the Stop chip shows it: "0:02", "1:05". */
export function takeClock(millis: number): string {
  const s = Math.max(0, Math.floor(millis / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
