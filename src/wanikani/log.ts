import type { Answer } from '../core/stats';
import type { Outcome } from './session';

/**
 * WaniKani answers given in Franki, kept on the phone for Stats. WaniKani's API doesn't list past
 * reviews, so this is the only record Franki has; answers given on wanikani.com aren't in it.
 */
export interface LogEntry {
  at: string;
  assignmentId: number;
  /** A review, or a lesson started. */
  kind: 'review' | 'start';
  /** Wrong answers before the item was right (always 0 for a lesson). */
  wrong: number;
  takenMs: number;
}

/** A year of answers, as long as Stats' calendar reaches, with some to spare. */
export const LOG_DAYS = 400;

/** The scope chip Stats shows for WaniKani, beside the top-level decks. */
export const WANIKANI_SCOPE = 'WaniKani';

/** `log` with `outcomes` added, and entries older than `LOG_DAYS` dropped. */
export function logOutcomes(log: LogEntry[], outcomes: Outcome[], now: Date): LogEntry[] {
  const cutoff = now.getTime() - LOG_DAYS * 86_400_000;
  const added = outcomes.map((o): LogEntry => ({
    at: o.at,
    assignmentId: o.assignmentId,
    kind: o.kind,
    wrong: o.kind === 'review' ? o.wrongMeaning + o.wrongReading : 0,
    takenMs: o.takenMs ?? 0,
  }));
  return [...log, ...added].filter((e) => Date.parse(e.at) >= cutoff);
}

export function parseLog(raw: unknown): LogEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((e): e is LogEntry => !!e && typeof e.at === 'string' && typeof e.assignmentId === 'number'
    && (e.kind === 'review' || e.kind === 'start') && typeof e.wrong === 'number' && typeof e.takenMs === 'number');
}

/** The id an item's answers count under in Stats. */
export const statsCardId = (assignmentId: number) => `wanikani:${assignmentId}`;

/**
 * The log as Stats' answers: a review answered right first time is Good, one missed along the way
 * is Again (so "Remembered" is WaniKani's own accuracy); a lesson is a new card learned.
 */
export function answersFromLog(log: LogEntry[]): Answer[] {
  return log.map((e) => ({
    cardId: statsCardId(e.assignmentId),
    at: new Date(e.at),
    rating: e.wrong > 0 ? 1 : 3,
    kind: e.kind === 'start' ? 'learn' : 'review',
    wasNew: e.kind === 'start',
    takenMs: e.takenMs,
  }));
}
