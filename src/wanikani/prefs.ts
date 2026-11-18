import { isSynonymChange, type SynonymChange } from './synonyms';
import { WaniKaniError, type WaniKaniProblem } from './api';
import { parseLog, type LogEntry } from './log';
import type { Outcome } from './session';
import { parseSkipped, type SkippedWord } from './skipped';

/** WaniKani's options in Franki: this phone's own, kept beside the token (storage.ts). */
export interface WaniKaniPrefs {
  /** Type a meaning, as on WaniKani, or show it and rate yourself. */
  typeMeaning: boolean;
  /** Type a reading (romaji turns into kana), or show it and rate yourself. */
  typeReading: boolean;
  /** Ask meaning and reading as two questions, as WaniKani does. */
  separate: boolean;
  /** Lessons a study day, counting lessons done on WaniKani itself that day. */
  newPerDay: number;
  /** Lessons are offered only while they'd keep Apprentice at or under this many items; null for no limit. */
  maxApprentice: number | null;
  /** Play WaniKani's recording when a vocabulary answer is shown. */
  autoplay: boolean;
  /** Animate the popup when an answer moves an item to another stage group; off, it only fades. Separate from the system's Reduce Motion, which turns it off as well. */
  stageAnimation: boolean;
  /** Make production cards (production.ts) for words at Guru. */
  production: boolean;
  /** The Anki deck they go in; unset until chosen or suggested. */
  productionDeck?: string;
}

export const DEFAULT_PREFS: WaniKaniPrefs = { typeMeaning: true, typeReading: true, separate: true, newPerDay: 15, maxApprentice: null, autoplay: true, stageAnimation: true, production: true };

export const NEW_PER_DAY_CHOICES = [0, 5, 10, 15, 20, 30, 50];

/** The Apprentice limits offered in options; null is no limit. */
export const APPRENTICE_LIMIT_CHOICES: (number | null)[] = [null, 25, 50, 75, 100, 125, 150, 200];

/** What was typed for a custom limit (Apprentice, or lessons a day): a whole number of 1 or more, else null (refused with the reason on screen). */
export function parseLimit(text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && Number.isSafeInteger(n) ? n : null;
}

export function parsePrefs(raw: string | null | undefined): WaniKaniPrefs {
  let o: Record<string, unknown> = {};
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object') o = parsed;
  } catch {
    // A setting that can't be read is the default.
  }
  return {
    // `answer` ('type' or 'flip') was one choice for both before they were split.
    typeMeaning: typeof o.typeMeaning === 'boolean' ? o.typeMeaning : o.answer !== 'flip',
    typeReading: typeof o.typeReading === 'boolean' ? o.typeReading : o.answer !== 'flip',
    separate: typeof o.separate === 'boolean' ? o.separate : DEFAULT_PREFS.separate,
    newPerDay: typeof o.newPerDay === 'number' && o.newPerDay >= 0 ? Math.floor(o.newPerDay) : DEFAULT_PREFS.newPerDay,
    maxApprentice: typeof o.maxApprentice === 'number' && o.maxApprentice >= 0 ? Math.floor(o.maxApprentice) : null,
    autoplay: typeof o.autoplay === 'boolean' ? o.autoplay : DEFAULT_PREFS.autoplay,
    stageAnimation: typeof o.stageAnimation === 'boolean' ? o.stageAnimation : DEFAULT_PREFS.stageAnimation,
    production: typeof o.production === 'boolean' ? o.production : DEFAULT_PREFS.production,
    ...(typeof o.productionDeck === 'string' && o.productionDeck ? { productionDeck: o.productionDeck } : {}),
  };
}

/** How many more items the Apprentice limit lets in: the limit less those at Apprentice now; null for no limit. */
export function apprenticeRoom(apprentice: number, maxApprentice: number | null): number | null {
  return maxApprentice === null ? null : Math.max(0, maxApprentice - apprentice);
}

/** Whether the Apprentice limit holds lessons back: no room left under it. */
export function apprenticeBlocks(apprentice: number, maxApprentice: number | null): boolean {
  return apprenticeRoom(apprentice, maxApprentice) === 0;
}

/**
 * Lessons still to offer today: the day's limit less those already done (here or on WaniKani),
 * never more than are up, and never more than fit under the Apprentice limit (a limit of 25 with 17
 * at Apprentice leaves room for 8).
 */
export function lessonsToday(available: number, newPerDay: number, startedToday: number, apprentice = 0, maxApprentice: number | null = null): number {
  const room = apprenticeRoom(apprentice, maxApprentice);
  return Math.max(0, Math.min(available, newPerDay - startedToday, room ?? Infinity));
}

/**
 * Answers waiting to reach WaniKani (kept in a file, so one given offline isn't lost), the
 * production notes already made, and the answers given here (for Stats). All survive closing the app.
 */
export interface WaniKaniState {
  outbox: Outcome[];
  /** Answers sent since the offline copy was made (offline.ts): the copy still lists their items. */
  sent: Outcome[];
  made: number[];
  /** Answers given here, for Stats. */
  log: LogEntry[];
  /** Answers WaniKani refused (`FlushResult.dropped`) that the learner hasn't been shown yet (`droppedText`). */
  dropped: number;
  /** Words skipped for good (skipped.ts). */
  skipped: SkippedWord[];
  /** Meaning synonyms saved or taken back that WaniKani hasn't been told yet (synonyms.ts). */
  synonymChanges: SynonymChange[];
}

export function parseState(raw: string | null | undefined): WaniKaniState {
  try {
    const o = raw ? JSON.parse(raw) : null;
    return {
      outbox: Array.isArray(o?.outbox) ? o.outbox.filter(isOutcome) : [],
      sent: Array.isArray(o?.sent) ? o.sent.filter(isOutcome) : [],
      made: Array.isArray(o?.made) ? o.made.filter((x: unknown) => typeof x === 'number') : [],
      log: parseLog(o?.log),
      dropped: typeof o?.dropped === 'number' && o.dropped > 0 ? Math.floor(o.dropped) : 0,
      skipped: parseSkipped(o?.skipped),
      synonymChanges: Array.isArray(o?.synonymChanges) ? o.synonymChanges.filter(isSynonymChange) : [],
    };
  } catch {
    return { outbox: [], sent: [], made: [], log: [], dropped: 0, skipped: [], synonymChanges: [] };
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

/**
 * What the learner is told about answers WaniKani refused: what happened, and that nothing needs
 * doing. Each was for an item WaniKani no longer had up (reviewed on wanikani.com or in another app
 * since the offline copy was made, most often), so it kept its own answer and sending again won't help.
 */
export function droppedText(n: number): string {
  return n === 1
    ? "1 answer wasn't sent: WaniKani already had a newer answer for that item, from wanikani.com or another app. WaniKani keeps that one, so there's nothing to do."
    : `${n} answers weren't sent: WaniKani already had newer answers for those items, from wanikani.com or another app. WaniKani keeps those, so there's nothing to do.`;
}

/** The deck list's short line for the same, under WaniKani's name. */
export function droppedLine(n: number): string {
  return n === 1 ? "1 answer wasn't sent: WaniKani had a newer one" : `${n} answers weren't sent: WaniKani had newer ones`;
}
