// Shadowing in Watch (docs/read-and-listen/architecture.md, "Shadowing"): each line of a video or an
// episode plays once and stops, for the learner to say it back. Pure, so it's tested; the screen is
// src/ui/reader/useShadowing.ts. Nothing here is a rating.

type Times = readonly (readonly [number, number])[];

/** A line stops this far past its end, so its last word isn't cut (Loop line waits as long). */
export const SHADOW_GRACE_MS = 250;

/**
 * Where a shadowed line has got to at the player's time `ms`. `begun` is whether the player has been seen
 * inside the line since it was asked to play it: until then a time past the line's end is the player's
 * position before the seek took, not the line ending (a line played again is asked for from just past its
 * end). `done` is when it has played to its end, which pauses the player for the learner's turn.
 */
export function shadowTick(times: Times, line: number, begun: boolean, ms: number): { begun: boolean; done: boolean } {
  const t = times[line];
  if (!t) return { begun, done: false };
  const inside = ms >= t[0] - SHADOW_GRACE_MS && ms < t[1] + SHADOW_GRACE_MS;
  const now = begun || inside;
  return { begun: now, done: now && ms >= t[1] + SHADOW_GRACE_MS };
}

/** The line Shadow starts on: the one being said, else the first. */
export function shadowStart(line: number, count: number): number {
  return count === 0 ? -1 : Math.min(Math.max(line, 0), count - 1);
}

/** The line after `line`, or null after the last. */
export function nextShadowLine(line: number, count: number): number | null {
  return line + 1 < count ? line + 1 : null;
}
