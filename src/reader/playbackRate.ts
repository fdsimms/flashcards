// The reader plays a line at normal speed or slowly. Slow is its own recording, spoken slowly by
// Azure (server/reader tts.SLOW_RATE), because the player stretching a normal one sounds robotic.
// The rate is kept as a number: 1 for normal, SLOW_RATE for slow (what a reading log's audio speed holds).
export const NORMAL_RATE = 1;
export const SLOW_RATE = 0.8;

// The speeds the reader offers, slowest first.
export const RATES = [SLOW_RATE, NORMAL_RATE];

/** Whether a rate asks for the slow recording. */
export function isSlow(rate: number): boolean {
  return rate < NORMAL_RATE;
}

/**
 * A saved speed as one the reader offers. Any speed below normal (the reader once offered 0.7 to
 * 0.9) is slow; anything else is normal.
 */
export function toRate(saved: unknown): number {
  return typeof saved === 'number' && saved < NORMAL_RATE ? SLOW_RATE : NORMAL_RATE;
}
