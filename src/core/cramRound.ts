import type { CramRound } from './cram';

/**
 * One cram round (cram.ts): every word of the cram once, the ones missed in the last round first,
 * the rest shuffled. A word missed comes back `RETRY_AFTER` cards later, and the round ends once
 * each word has been answered Got it. Practice, never a rating: this imports nothing that schedules
 * or writes a card (tests/core/cramRound.test.ts), and the result is kept in the cram only.
 */

/** How many other words come between a miss and the word's next showing (fewer when fewer are left). */
export const RETRY_AFTER = 3;

export interface RoundState {
  /** Note ids still to answer, the next one first. */
  queue: string[];
  /** Every note in the round. */
  noteIds: string[];
  /** Notes missed at least once. */
  missed: string[];
}

/** A round over these notes: the ones missed last time first, in the order given, then the rest shuffled. */
export function startRound(noteIds: string[], missedLast: Set<string>, random: () => number = Math.random): RoundState {
  const first = noteIds.filter((id) => missedLast.has(id));
  const rest = noteIds.filter((id) => !missedLast.has(id));
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return { queue: [...first, ...rest], noteIds: [...noteIds], missed: [] };
}

/** The word now showing, or undefined once the round is done. */
export const currentWord = (round: RoundState): string | undefined => round.queue[0];

export const isRoundDone = (round: RoundState) => round.queue.length === 0;

/** The round after the word showing was answered: Got it takes it out; Missed it puts it back a few words on. */
export function answerWord(round: RoundState, got: boolean): RoundState {
  const [id, ...rest] = round.queue;
  if (id === undefined) return round;
  if (got) return { ...round, queue: rest };
  const at = Math.min(RETRY_AFTER, rest.length);
  return {
    ...round,
    queue: [...rest.slice(0, at), id, ...rest.slice(at)],
    missed: round.missed.includes(id) ? round.missed : [...round.missed, id],
  };
}

/** Takes a word out of the round without an answer (its note was deleted, say). */
export function dropWord(round: RoundState, noteId: string): RoundState {
  return { queue: round.queue.filter((id) => id !== noteId), noteIds: round.noteIds.filter((id) => id !== noteId), missed: round.missed.filter((id) => id !== noteId) };
}

/** How many words are still to be got. */
export const wordsLeft = (round: RoundState) => new Set(round.queue).size;

/** What's kept in the cram once the round is done. */
export const roundRecord = (round: RoundState, now: Date): CramRound => ({ finishedAt: now.toISOString(), noteIds: round.noteIds, missed: round.missed });
