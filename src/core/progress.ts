import type { RatingValue } from './scheduler';
import type { Card } from './types';

/**
 * WaniKani's progress stages, kept on every card beside its FSRS state, for the progress gate:
 * a gated deck shows new cards only while fewer than its cap are below Guru.
 *
 *   0 new · 1-4 Apprentice · 5-6 Guru · 7 Master · 8 Enlightened · 9 Burned
 *
 * Finishing learning a new card puts it at Apprentice 1, as finishing a lesson does on WaniKani.
 * Each correct answer to a due review moves it up one stage. A wrong one moves it down one, or two
 * from Guru up, never below Apprentice 1 (WaniKani's penalty for a single wrong answer). Answers
 * during learning and relearning steps don't move it, the same as WaniKani's retries within a
 * session. So a card reaches Guru on its fourth correct review in a row.
 *
 * FSRS still decides when a card is due; the stage only records how far it has come.
 */

export const APPRENTICE_1 = 1;
export const GURU = 5;
const BURNED = 9;

/** A card's stage after an answer, from the state it was in before (ts-fsrs State) and the rating. */
export function nextStage(stage: number, stateBefore: number, rating: RatingValue): number {
  if (stateBefore === 2) {
    if (rating === 1) return Math.max(APPRENTICE_1, stage - (stage >= GURU ? 2 : 1));
    return Math.min(BURNED, Math.max(stage, APPRENTICE_1) + 1);
  }
  // New or learning: the card has been met, so it's at least Apprentice 1. Relearning steps after
  // a lapse leave the stage where the lapse put it.
  if (stateBefore === 0 || stateBefore === 1) return Math.max(stage, APPRENTICE_1);
  return stage;
}

/** Below Guru and already started: what the gate counts. New cards don't count until they're met. */
export function isApprentice(card: Card): boolean {
  return card.sched.state !== 0 && card.stage < GURU;
}

/**
 * Anki's review log entry types (revlog.type), in the compact form the exporter writes:
 * `type * 10 + ease`, oldest first. 13 is a review answered Good.
 */
const REVLOG_STATE: Record<number, number | undefined> = {
  0: 1, // learning step
  1: 2, // review
  2: 3, // relearning step
  3: 2, // filtered-deck review: a real answer to a card that was due or early
  // 4 (manual reschedule) and 5 (rescheduled by Anki) aren't answers.
};

/**
 * A card's stage from its Anki review history, by the same rule as `nextStage`, so a card arrives
 * where it would be had it been studied here all along.
 */
export function stageFromHistory(history: number[]): number {
  let stage = 0;
  for (const entry of history) {
    const state = REVLOG_STATE[Math.floor(entry / 10)];
    const ease = entry % 10;
    if (state === undefined || ease < 1 || ease > 4) continue;
    stage = nextStage(stage, state, ease as RatingValue);
  }
  return stage;
}

/**
 * A stage guessed from scheduling alone, for an import without history (TSV, AnkiConnect JSON) and
 * for cards stored before stages existed: a review a week or more out has proven itself about as
 * well as a Guru card, whose next review WaniKani puts a week away. Any other started card is
 * one correct review short of Guru (a review) or just met (learning).
 */
export function stageFromSchedule(state: number, scheduledDays: number): number {
  if (state === 0) return 0;
  if (state === 2) return scheduledDays >= 7 ? GURU : GURU - 1;
  return APPRENTICE_1;
}

/**
 * The cap typed on Deck options, or why it can't be used. Refused inline, never quietly changed
 * into some other number.
 */
export function parseGateCap(text: string): { cap: number } | { error: string } {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return { error: 'Enter a whole number, for example 100.' };
  const cap = Number(t);
  if (cap < 1) return { error: 'The cap has to be at least 1, or no new cards would ever show.' };
  if (cap > 5000) return { error: 'The cap can be at most 5000.' };
  return { cap };
}
