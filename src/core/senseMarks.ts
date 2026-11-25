import type { MissAnswers } from './misses';

/**
 * Missed senses: for a note whose Meaning numbers several senses, the learner taps the ones they
 * didn't recall on the answer, and the next time the card comes up it says one was missed (not
 * which) and marks it on the answer.
 *
 * A mark is a more specific miss reason (misses.ts): it is kept in the answer's own review row
 * (`ReviewLogEntry.miss`, as `sense:2` or `sense:1,3`), with whichever rating was pressed, so undo
 * takes it back with the answer. Like every miss reason it is a reminder only: nothing that
 * schedules or builds the queue reads it, the rating is the learner's tap, and it isn't written
 * into the Anki collection. The reminder is read from the card's latest answer each time, never
 * stored, so it goes after the next answer without a mark.
 *
 * Pure: the screen gathers the answers.
 */

const NUMBERED = /^\d+[.)]\s+/;
const PREFIX = 'sense:';

/**
 * The senses of a Meaning that numbers them, each without its number, or none when it doesn't:
 * every line has to start with a number and there have to be two or more. `meaning` is the field
 * as text, a sense to a line.
 */
export function numberedSenses(meaning: string): string[] {
  const lines = meaning.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2 || !lines.every((l) => NUMBERED.test(l))) return [];
  return lines.map((l) => l.replace(NUMBERED, '').trim());
}

/** Whether a review row's reason is a missed sense. Those are kept with any rating; other reasons only with Again. */
export function isSenseMiss(miss: string | undefined): miss is string {
  return !!miss && miss.startsWith(PREFIX);
}

/** The reason to keep for the senses marked (their numbers, from 1), or undefined for none. */
export function senseMissKey(marked: Iterable<number>): string | undefined {
  const numbers = [...new Set(marked)].filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
  return numbers.length ? `${PREFIX}${numbers.join(',')}` : undefined;
}

/**
 * The senses the card's latest answer marked, as numbers from 1, in order. None when that answer
 * had no mark, or when the Meaning has since changed so that a number no longer names a sense
 * (`count` senses now): a reminder that might point at the wrong sense is left off.
 */
export function lastMissedSenses(answers: MissAnswers, count: number): number[] {
  const last = answers[answers.length - 1];
  if (!isSenseMiss(last)) return [];
  const numbers = last.slice(PREFIX.length).split(',').map(Number);
  return numbers.every((n) => Number.isInteger(n) && n >= 1 && n <= count) ? numbers : [];
}

const COUNTS = ['', 'one', 'two', 'three', 'four', 'five'];

/** The line under the card's front: how many senses there are and how many were missed, never which. Null with none missed. */
export function senseReminder(count: number, missed: readonly number[]): string | null {
  if (!missed.length) return null;
  const said = missed.length === count ? 'all of them' : COUNTS[missed.length] ?? String(missed.length);
  return `${count} senses. You missed ${said} last time.`;
}

/**
 * The line under the card's front saying how many meanings the answer has, so the learner knows when
 * they've recalled them all. Null with fewer than two senses, where there is nothing to count. Display only.
 */
export function senseCountLabel(count: number): string | null {
  return count >= 2 ? `${count} meanings` : null;
}

/** The senses not missed last time, for the front's "Show the ones you got". */
export function sensesGot(senses: readonly string[], missed: readonly number[]): string[] {
  return senses.filter((_, i) => !missed.includes(i + 1));
}

/**
 * The senses to show as recalled when the card comes back: the ones its latest answer did not miss,
 * as numbers from 1. None when nothing was missed (no mark, nothing to carry over). Display only: a
 * recalled sense is never kept with the answer.
 */
export function carriedRecalled(count: number, missed: readonly number[]): number[] {
  if (!missed.length) return [];
  return Array.from({ length: count }, (_, i) => i + 1).filter((n) => !missed.includes(n));
}
