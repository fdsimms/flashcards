import type { StageChange } from './srs';

/**
 * The level-up popups on screen at once (StagePopup.tsx). A new one doesn't cut the one before it:
 * it swoops in from alternating sides, and every older one is pushed up and away from that side,
 * tilting the way it moves. A drop comes straight up and pushes upward only. Pure, so the
 * arrangement is tested; the screen only animates to what `stackSlots` says.
 */

/** Most popups shown at once; a newer one past this fades the oldest out early. */
export const MAX_POPUPS = 3;
/** What one newer popup does to each older one: points sideways (away from its entry side), points up, degrees of tilt, and a share of size. */
export const PUSH_X = 40;
export const PUSH_Y = 42;
export const PUSH_TILT = 3.5;
export const PUSH_SCALE = 0.95;
/** However many pushes pile up, a popup never moves further sideways than this. */
export const X_LIMIT = 64;
/** How much dimmer each step down the stack is. */
const DIM_STEP = 0.25;

/** The side a popup swoops in from: -1 the left, 1 the right, 0 none (a drop). */
export type Side = -1 | 0 | 1;

export interface StackEntry {
  id: number;
  change: StageChange;
  side: Side;
  /** Pushed out by a newer one past `MAX_POPUPS`: it fades away and is then removed. */
  out: boolean;
}

/** Where an entry rests, relative to where the newest one lands: offsets in points, tilt in degrees. */
export interface Slot {
  x: number;
  y: number;
  tilt: number;
  scale: number;
  opacity: number;
}

/** Rises alternate sides, the first coming in from the left; `last` is the side of the one before. */
export function nextSide(last: -1 | 1): -1 | 1 {
  return last === 1 ? -1 : 1;
}

/** `entry` joins as the newest. Live entries past `MAX_POPUPS`, oldest first, are marked `out`. */
export function pushPopup(stack: StackEntry[], entry: StackEntry): StackEntry[] {
  const next = [...stack, entry];
  let live = next.filter((e) => !e.out).length;
  return next.map((e) => (!e.out && live > MAX_POPUPS ? (live--, { ...e, out: true }) : e));
}

export function removePopup(stack: StackEntry[], id: number): StackEntry[] {
  return stack.some((e) => e.id === id) ? stack.filter((e) => e.id !== id) : stack;
}

/**
 * Where each entry rests: the sum of the pushes of every entry newer than it, so a run of rises from
 * alternating sides zigzags around the middle instead of drifting off one side. The newest sits
 * level at 0. One that expires lets the rest settle back, since they are placed from what's left.
 */
export function stackSlots(stack: StackEntry[]): Slot[] {
  return stack.map((entry, i) => {
    let x = 0;
    let y = 0;
    let tilt = 0;
    let scale = 1;
    let newerLive = 0;
    for (const newer of stack.slice(i + 1)) {
      x = Math.max(-X_LIMIT, Math.min(X_LIMIT, x - newer.side * PUSH_X));
      y -= PUSH_Y;
      tilt -= newer.side * PUSH_TILT;
      scale *= PUSH_SCALE;
      if (!newer.out) newerLive += 1;
    }
    return { x, y, tilt, scale, opacity: entry.out ? 0 : Math.max(0, 1 - DIM_STEP * newerLive) };
  });
}
