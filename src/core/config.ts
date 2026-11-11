/**
 * Study settings. Constants for now; when they become user settings, every caller already
 * takes them as parameters, so only where they're read from changes.
 *
 * One definition each, because the deck list and the review screen both count new cards and a
 * second copy of the limit is how the two would come to disagree.
 */

/** New cards introduced per deck per study day. */
export const NEW_PER_DAY = 20;

/** The hour the study day starts, as Anki's "Next day starts at" (4 AM by default). */
export const DAY_STARTS_AT_HOUR = 4;
