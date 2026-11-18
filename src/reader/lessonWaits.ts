// Waiting for the learner's answer in an audio lesson (docs/read-and-listen/architecture.md, Audio
// lessons): with Wait for my answer on, the lesson stops at each place the learner speaks (the server
// sends each one's start and end in the MP3, `AudioLesson.pauses`) and goes on when they tap
// Continue, past the rest of the silence. Nothing here is heard or graded: the learner's answer
// stays with them. Pure, so it's tested; useLessonWaits drives the player with it.
import type { AudioLesson } from './api';

/** Where the learner speaks: start and end, in milliseconds from the lesson's start. */
export type Pause = readonly [number, number];

/** A pause this close to its end isn't stopped at: skipping forward into its last moment shouldn't stop the lesson. */
export const LATE_MS = 600;
/** Continue goes on this long before the end of the silence, so the answer doesn't start the instant the tap lands. */
export const LEAD_MS = 250;
/** After stopping, the player can still report playing for a moment; past this, playing again means Play was pressed (the lock screen's, or the tab bar's). */
export const SETTLE_MS = 1_000;

/** A lesson's pauses, in order, as far as they can be trusted: none for a lesson made before they were kept, until the server has found them. */
export function pausesOf(lesson: Pick<AudioLesson, 'pauses'>): Pause[] {
  const raw = lesson.pauses;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is [number, number] => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[0] < p[1])
    .map((p) => [p[0], p[1]] as const)
    .sort((a, b) => a[0] - b[0]);
}

/** The pause the player is in at `seconds`, or -1 when it's between them or too near one's end to stop. */
export function pauseAt(pauses: readonly Pause[], seconds: number): number {
  const ms = seconds * 1000;
  return pauses.findIndex(([start, end]) => ms >= start && ms < end - LATE_MS);
}

/** Where Continue goes on from: just before the end of the silence, so what comes after plays next. */
export function continueFrom(pause: Pause): number {
  return Math.max(pause[0], pause[1] - LEAD_MS) / 1000;
}

/**
 * Where waiting has got to. `held` is the pause the lesson is stopped at, with when it stopped and
 * whether the player has said it's paused yet; `passed` is the pause just gone on from, which isn't
 * stopped at again while the player is still inside it (Continue lands there).
 */
export type WaitState = {
  held: { index: number; at: number; paused: boolean } | null;
  passed: number;
};

export const NOT_WAITING: WaitState = { held: null, passed: -1 };

/** What the player should do on a status update: nothing, stop at a pause, or go on past the one it's held at. */
export type WaitStep = { state: WaitState; act: 'none' | 'hold' | 'continue' };

/**
 * One status update from the player. Stops when playing reaches a pause it hasn't just gone on
 * from. While held, playing again (Play on the lock screen or the tab bar, not Continue, which
 * clears the hold itself) goes on as Continue does, past the rest of the silence; a report of
 * playing that comes before the player has said it's paused, and within SETTLE_MS, is the stop
 * still landing and is let be.
 */
export function waitTick(state: WaitState, pauses: readonly Pause[], tick: { seconds: number; playing: boolean; now: number }): WaitStep {
  const index = pauseAt(pauses, tick.seconds);
  if (state.held) {
    if (!tick.playing) return { state: state.held.paused ? state : { ...state, held: { ...state.held, paused: true } }, act: 'none' };
    if (!state.held.paused && tick.now - state.held.at < SETTLE_MS) return { state, act: 'none' };
    return { state: { held: null, passed: state.held.index }, act: 'continue' };
  }
  const passed = index === state.passed ? state.passed : -1;
  if (tick.playing && index !== -1 && index !== passed) {
    return { state: { held: { index, at: tick.now, paused: false }, passed }, act: 'hold' };
  }
  return { state: passed === state.passed ? state : { ...state, passed }, act: 'none' };
}

/** Continue was tapped: the hold is let go, and the pause isn't stopped at again while the player is inside it. */
export function letGo(state: WaitState): WaitState {
  return state.held ? { held: null, passed: state.held.index } : state;
}

/** The line under the player's Wait for my answer switch: what it does, or why this lesson won't stop. */
export function waitHint(lesson: Pick<AudioLesson, 'pauses'>): string {
  if (lesson.pauses === null) return 'This lesson is older, and the server is still finding its pauses. Open it again in a minute to have it wait.';
  if (!pausesOf(lesson).length) return "This lesson has no pauses to stop at, so it plays straight through.";
  return 'Stops at each pause until you tap Continue';
}

/** The wait setting as kept: off (the lesson plays straight through, for the car) unless it was turned on. */
export function parseWait(raw: string | null): boolean {
  return raw === 'on';
}
