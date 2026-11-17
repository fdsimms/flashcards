import { studyDayStart } from '../core/day';
import type { LogEntry } from './log';

/**
 * What the WaniKani row and its stats screen show beyond the due and new counts: items by stage
 * group, the current level's progress, and the reviews coming up. Read from WaniKani's API
 * (`stageCounts`, `levelCounts`, `summary` in api.ts) and kept on the phone so the screen still
 * opens with no connection. Nothing here schedules or grades anything.
 */

export interface StageCounts {
  apprentice: number;
  guru: number;
  master: number;
  enlightened: number;
  burned: number;
}

/** The stage groups in order, as the stage popup and the bars name them. */
export const STAGE_GROUPS: { key: keyof StageCounts; label: string }[] = [
  { key: 'apprentice', label: 'Apprentice' },
  { key: 'guru', label: 'Guru' },
  { key: 'master', label: 'Master' },
  { key: 'enlightened', label: 'Enlightened' },
  { key: 'burned', label: 'Burned' },
];

/** WaniKani's last level; there's none after it to reach. */
export const LAST_LEVEL = 60;
/** Share of a level's kanji that must be at Guru or above to reach the next level (WaniKani's rule). */
const LEVEL_UP_SHARE = 0.9;
/** Hours of reviews the forecast covers: what WaniKani's summary lists. */
export const FORECAST_HOURS = 24;

export interface LevelProgress {
  level: number;
  kanjiTotal: number;
  /** Kanji at Guru or above. */
  kanjiPassed: number;
  /** How many of them the next level needs. */
  needed: number;
  /** Kanji still to take to Guru; 0 when the level is already passed. */
  remaining: number;
}

/** The current level's progress, or null when there's nothing to say (the last level, or no kanji read). */
export function levelProgress(level: number, kanjiTotal: number, kanjiPassed: number): LevelProgress | null {
  if (level >= LAST_LEVEL || kanjiTotal <= 0) return null;
  const needed = Math.ceil(kanjiTotal * LEVEL_UP_SHARE);
  return { level, kanjiTotal, kanjiPassed, needed, remaining: Math.max(0, needed - kanjiPassed) };
}

/** A batch of reviews WaniKani says will come up at `availableAt`. */
export interface ReviewBatch {
  availableAt: string;
  count: number;
}

/**
 * Reviews per hour for the next `FORECAST_HOURS`: index 0 is now and anything already waiting, then
 * each hour after it. A batch before `now` counts as now; one past the window is left out.
 */
export function hourlyForecast(batches: ReviewBatch[], now: Date): number[] {
  const out = new Array<number>(FORECAST_HOURS).fill(0);
  for (const b of batches) {
    const at = Date.parse(b.availableAt);
    if (Number.isNaN(at)) continue;
    const hour = Math.max(0, Math.floor((at - now.getTime()) / 3_600_000));
    if (hour < FORECAST_HOURS) out[hour] += b.count;
  }
  return out;
}

export interface WaniKaniStats {
  /** When it was read. */
  savedAt: string;
  level: number;
  stages: StageCounts;
  progress: LevelProgress | null;
  forecast: number[];
}

export function parseStats(raw: string | null | undefined): WaniKaniStats | null {
  try {
    const o = raw ? JSON.parse(raw) : null;
    if (typeof o?.savedAt !== 'string' || typeof o.level !== 'number') return null;
    if (!STAGE_GROUPS.every((g) => typeof o.stages?.[g.key] === 'number')) return null;
    if (!Array.isArray(o.forecast) || o.forecast.length !== FORECAST_HOURS || !o.forecast.every((n: unknown) => typeof n === 'number')) return null;
    return o as WaniKaniStats;
  } catch {
    return null;
  }
}

/** Items started: every stage group together. */
export const startedTotal = (s: StageCounts): number => STAGE_GROUPS.reduce((n, g) => n + s[g.key], 0);

/** The row's line under the name: the level, and how many kanji are left before the next one. */
export function levelLine(level: number, progress: LevelProgress | null): string {
  if (!progress || progress.level !== level || progress.remaining === 0) return `Level ${level}`;
  return `Level ${level} · ${progress.remaining} kanji to level ${level + 1}`;
}

/** What the row's stage bar says aloud. */
export function stagesLabel(s: StageCounts): string {
  return STAGE_GROUPS.map((g) => `${s[g.key]} ${g.label}`).join(', ');
}

/** Reviews due in the next 24 hours, not counting those already waiting. */
export const comingUp = (forecast: number[]): number => forecast.slice(1).reduce((n, v) => n + v, 0);

export interface AnswerSummary {
  reviewsToday: number;
  lessonsToday: number;
  /** Reviews in the last 7 study days. */
  reviewsWeek: number;
  /** Share of those right the first time, in percent; null with none. */
  rightFirstTimeWeek: number | null;
}

/** Answers given in Franki (log.ts), today and over the last 7 study days. */
export function answerSummary(log: LogEntry[], now: Date, dayStartsAtHour: number): AnswerSummary {
  const today = studyDayStart(now, dayStartsAtHour).getTime();
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - 6);
  const week = log.filter((e) => e.kind === 'review' && Date.parse(e.at) >= weekStart.getTime());
  const right = week.filter((e) => e.wrong === 0).length;
  return {
    reviewsToday: log.filter((e) => e.kind === 'review' && Date.parse(e.at) >= today).length,
    lessonsToday: log.filter((e) => e.kind === 'start' && Date.parse(e.at) >= today).length,
    reviewsWeek: week.length,
    rightFirstTimeWeek: week.length ? Math.round((right / week.length) * 100) : null,
  };
}
