import type { Card } from './types';

/**
 * What the progress gate counts: cards that are still in progress, the way WaniKani counts its
 * Apprentice items. WaniKani's Guru stage means "next review a week away", so here a card has made
 * it once FSRS has scheduled its next review a week or more out. Until then (still in learning,
 * relearning after a lapse, or reviewing at intervals under a week) it counts against the cap.
 *
 * Measured on the card's FSRS interval, not by counting correct answers: FSRS spaces reviews out
 * much faster than WaniKani's fixed 4h / 8h / 1d / 2d, so "four right in a row" took weeks here
 * and held cards against the cap long after they were known. A lapse shortens the interval, so a
 * forgotten card counts again until it's back to a week.
 */

/** The largest cap a gate can have (the MCP's `MAX_GATE_CAP` in server/mcp/franki_mcp/tools.py is the same number). */
export const MAX_GATE_CAP = 5000;

/** A card whose next review is at least this many days out is no longer in progress (WaniKani's Guru interval). */
export const GURU_INTERVAL_DAYS = 7;

/** Started, and not yet scheduled a week or more out. New cards don't count until they're met. */
export function isInProgress(card: Card): boolean {
  if (card.sched.state === 0) return false;
  return !(card.sched.state === 2 && card.sched.scheduledDays >= GURU_INTERVAL_DAYS);
}

/**
 * The cap typed on Deck options, or why it can't be used. Refused inline, never quietly changed
 * into some other number.
 */
export function parseGateCap(text: string): { cap: number } | { error: string } {
  const t = text.trim();
  const cap = Number(t);
  if (!/^\d+$/.test(t) || cap < 1 || cap > MAX_GATE_CAP) return { error: `Enter a whole number from 1 to ${MAX_GATE_CAP}.` };
  return { cap };
}
