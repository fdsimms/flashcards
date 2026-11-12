import { WaniKaniError, type WaniKaniProblem } from './api';
import { parseLog, type LogEntry } from './log';
import type { Outcome } from './session';

/** WaniKani's options in Franki: this phone's own, kept beside the token (storage.ts). */
export interface WaniKaniPrefs {
  /** Type the answer, as on WaniKani, or show it and rate yourself. */
  answer: 'type' | 'flip';
  /** Ask meaning and reading as two questions, as WaniKani does. */
  separate: boolean;
  /** Lessons a study day, counting lessons done on WaniKani itself that day. */
  newPerDay: number;
  /** Play WaniKani's recording when a vocabulary answer is shown. */
  autoplay: boolean;
  /** Make production cards (production.ts) for words at Guru. */
  production: boolean;
  /** The Anki deck they go in; unset until chosen or suggested. */
  productionDeck?: string;
}

export const DEFAULT_PREFS: WaniKaniPrefs = { answer: 'type', separate: true, newPerDay: 15, autoplay: true, production: true };

export const NEW_PER_DAY_CHOICES = [0, 5, 10, 15, 20, 30, 50];

export function parsePrefs(raw: string | null | undefined): WaniKaniPrefs {
  let o: Record<string, unknown> = {};
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object') o = parsed;
  } catch {
    // A setting that can't be read is the default.
  }
  return {
    answer: o.answer === 'flip' ? 'flip' : o.answer === 'type' ? 'type' : DEFAULT_PREFS.answer,
    separate: typeof o.separate === 'boolean' ? o.separate : DEFAULT_PREFS.separate,
    newPerDay: typeof o.newPerDay === 'number' && o.newPerDay >= 0 ? Math.floor(o.newPerDay) : DEFAULT_PREFS.newPerDay,
    autoplay: typeof o.autoplay === 'boolean' ? o.autoplay : DEFAULT_PREFS.autoplay,
    production: typeof o.production === 'boolean' ? o.production : DEFAULT_PREFS.production,
    ...(typeof o.productionDeck === 'string' && o.productionDeck ? { productionDeck: o.productionDeck } : {}),
  };
}

/** Lessons still to offer today: the day's limit less those already done (here or on WaniKani), never more than are up. */
export function lessonsToday(available: number, newPerDay: number, startedToday: number): number {
  return Math.max(0, Math.min(available, newPerDay - startedToday));
}

/**
 * Answers waiting to reach WaniKani (kept in a file, so one given offline isn't lost), the
 * production notes already made, and the answers given here (for Stats). All survive closing the app.
 */
export interface WaniKaniState {
  outbox: Outcome[];
  made: number[];
  /** Answers given here, for Stats. */
  log: LogEntry[];
}

export function parseState(raw: string | null | undefined): WaniKaniState {
  try {
    const o = raw ? JSON.parse(raw) : null;
    return {
      outbox: Array.isArray(o?.outbox) ? o.outbox.filter(isOutcome) : [],
      made: Array.isArray(o?.made) ? o.made.filter((x: unknown) => typeof x === 'number') : [],
      log: parseLog(o?.log),
    };
  } catch {
    return { outbox: [], made: [], log: [] };
  }
}

function isOutcome(x: unknown): x is Outcome {
  const o = x as Partial<Outcome> | null;
  return !!o && (o.kind === 'review' || o.kind === 'start') && typeof o.assignmentId === 'number' && typeof o.at === 'string';
}

export interface FlushResult {
  /** Still to send: everything from the first one that couldn't go. */
  left: Outcome[];
  sent: Outcome[];
  /** Refused by WaniKani for good (the item was reviewed elsewhere): not sent again. */
  dropped: Outcome[];
  /** Why sending stopped, when it did. */
  problem?: WaniKaniProblem;
}

/**
 * Sends each outcome in order. A refusal drops that one and goes on; anything that could work
 * later (no connection, a bad token) stops there and keeps the rest, in order, for next time.
 */
export async function flushOutbox(outbox: Outcome[], send: (o: Outcome) => Promise<void>): Promise<FlushResult> {
  const sent: Outcome[] = [];
  const dropped: Outcome[] = [];
  for (let i = 0; i < outbox.length; i++) {
    try {
      await send(outbox[i]);
      sent.push(outbox[i]);
    } catch (e) {
      const problem = e instanceof WaniKaniError ? e.problem : 'unavailable';
      if (problem === 'rejected') {
        dropped.push(outbox[i]);
        continue;
      }
      return { left: outbox.slice(i), sent, dropped, problem };
    }
  }
  return { left: [], sent, dropped };
}
