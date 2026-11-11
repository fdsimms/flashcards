/**
 * Study settings. Constants for now; when they become user settings, every caller already
 * takes them as parameters, so only where they're read from changes.
 *
 * One definition each, because the deck list and the review screen both count new cards and a
 * second copy of the limit is how the two would come to disagree.
 */

/** New cards introduced per deck per study day, for a deck whose Anki preset didn't say (Anki's default). */
export const NEW_PER_DAY = 20;

/** Reviews per deck per study day, for a deck whose Anki preset didn't say (Anki's default). */
export const REVIEWS_PER_DAY = 200;

/** The hour the study day starts, as Anki's "Next day starts at" (4 AM by default). */
export const DAY_STARTS_AT_HOUR = 4;

/**
 * How early a learning card may be shown when nothing else is left, as Anki's "Learn ahead limit"
 * (20 minutes by default). Without it, pressing Again on the last card ends the session with
 * that card due a minute later.
 */
export const LEARN_AHEAD_MINUTES = 20;
