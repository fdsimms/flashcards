import { dayKeyOf, studyDayKey } from './day';
import type { DeckLimits } from './deckTree';
import type { Card } from './types';

/**
 * Vacation mode (Franki's own, never written to Anki): a lighter load while away, so a trip doesn't
 * leave a wall of reviews. It only changes what a deck offers each day and in what order, never a
 * card's schedule, so FSRS still sees the real time since each review.
 *
 * - **Light** shows at most `newPerDeck` new cards per deck and `reviewPercent` of each deck's own
 *   review limit, weakest cards first (relative overdueness), so the fewer reviews go to the cards
 *   closest to being forgotten.
 * - **Paused** shows nothing.
 * - **After it ends** the weakest-first order stays on while a review that came due before the end
 *   is still waiting, for at most `CATCH_UP_DAYS`, then the deck's own order returns.
 *
 * Pure, so it's tested; src/ui/vacationPrefs.ts keeps the setting on the phone. Days are study-day
 * keys (`studyDayKey`), so a vacation ends at the collection's "Next day starts at", not midnight.
 */

export type VacationMode = 'off' | 'light' | 'paused';

/** The lengths the screen offers, in days; 0 is no end date. */
export const VACATION_LENGTHS = [3, 7, 14, 0] as const;
export const VACATION_NEW_CHOICES = [0, 1, 2, 3, 5] as const;
export const VACATION_REVIEW_CHOICES = [10, 25, 50, 75] as const;
/** How long after a vacation ends the weakest-first order can stay on, whatever is left. */
export const CATCH_UP_DAYS = 14;
/** How long after a vacation ends the deck list says so. */
export const WELCOME_BACK_DAYS = 2;

export interface VacationPrefs {
  /** The chosen level. A vacation that has ended keeps its level; `vacationState` says whether it still applies. */
  mode: VacationMode;
  /** Light's new cards per deck. */
  newPerDeck: number;
  /** Light's share of each deck's review limit, in percent. */
  reviewPercent: number;
  /** One of `VACATION_LENGTHS`: how many days it was set for, 0 for none. */
  length: number;
  /** The study day it started and the first study day back to normal; undefined before the first vacation, and `until` for no end. */
  from?: string;
  until?: string;
}

export const DEFAULT_VACATION: VacationPrefs = { mode: 'off', newPerDeck: 1, reviewPercent: 50, length: 14 };

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

// Anything unreadable or out of range falls back to the default for that setting.
export function parseVacation(raw: string | null): VacationPrefs {
  let saved: Partial<Record<keyof VacationPrefs, unknown>> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object') saved = parsed as typeof saved;
  } catch {
    // Not JSON: use the defaults.
  }
  const pick = <T extends number>(v: unknown, allowed: readonly T[], fallback: number) => (allowed.includes(v as T) ? (v as number) : fallback);
  const day = (v: unknown) => (typeof v === 'string' && DAY_KEY.test(v) ? v : undefined);
  const from = day(saved.from);
  const until = day(saved.until);
  return {
    mode: saved.mode === 'light' || saved.mode === 'paused' ? saved.mode : 'off',
    newPerDeck: pick(saved.newPerDeck, VACATION_NEW_CHOICES, DEFAULT_VACATION.newPerDeck),
    reviewPercent: pick(saved.reviewPercent, VACATION_REVIEW_CHOICES, DEFAULT_VACATION.reviewPercent),
    length: pick(saved.length, VACATION_LENGTHS, DEFAULT_VACATION.length),
    ...(from ? { from } : {}),
    ...(until ? { until } : {}),
  };
}

/** Whole calendar days from one study-day key to another (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const at = (k: string) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
  return Math.round((at(to) - at(from)) / 86_400_000);
}

/** The study-day key `days` after `key`, by the calendar (DST-safe). */
export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return dayKeyOf(new Date(y, m - 1, d + days));
}

/** The level that applies on the study day `today`: the chosen one until the end date, then off. */
export function activeMode(prefs: VacationPrefs, today: string): VacationMode {
  if (prefs.mode === 'off') return 'off';
  return prefs.until !== undefined && today >= prefs.until ? 'off' : prefs.mode;
}

/** The setting after choosing a level: turning one on starts today and ends after the chosen length; Off ends it now. */
export function chooseMode(prefs: VacationPrefs, mode: VacationMode, today: string): VacationPrefs {
  if (mode === 'off') {
    // Ending by hand still brings the catch-up order back, as reaching the end date does.
    const ended = activeMode(prefs, today) !== 'off';
    return { ...prefs, mode: 'off', ...(ended ? { until: today } : {}) };
  }
  if (activeMode(prefs, today) !== 'off') return { ...prefs, mode };
  return { ...prefs, mode, from: today, ...endFor(prefs.length, today) };
}

/** The setting after choosing a length: the end date moves to that many days from today. */
export function chooseLength(prefs: VacationPrefs, length: number, today: string): VacationPrefs {
  const next = { ...prefs, length };
  if (activeMode(prefs, today) === 'off') return next;
  const { until: _dropped, ...rest } = next;
  return { ...rest, ...endFor(length, today) };
}

const endFor = (length: number, today: string): { until?: string } => (length > 0 ? { until: addDays(today, length) } : {});

/** What `treeQueue` applies, from the setting and the cards. Undefined: nothing changes. */
export interface VacationPlan {
  /** Paused: nothing is offered. */
  paused: boolean;
  /** Light: the most new cards a deck offers. */
  newPerDeck?: number;
  /** Light: the share of each deck's review limit, 0 to 1. */
  reviewShare?: number;
  /** Reviews come weakest first, whatever the deck's own review order is. */
  weakestFirst: boolean;
}

/** A review that came due before the vacation ended and still waits. */
const backlogged = (c: Card, until: string, dayStartsAtHour: number) =>
  !c.suspended && !c.retired && c.sched.state === 2 && studyDayKey(new Date(c.sched.due), dayStartsAtHour) < until;

export function vacationPlan(prefs: VacationPrefs | undefined, cards: Card[], now: Date, dayStartsAtHour: number): VacationPlan | undefined {
  if (!prefs) return undefined;
  const today = studyDayKey(now, dayStartsAtHour);
  const mode = activeMode(prefs, today);
  if (mode === 'paused') return { paused: true, weakestFirst: true };
  if (mode === 'light') return { paused: false, newPerDeck: prefs.newPerDeck, reviewShare: prefs.reviewPercent / 100, weakestFirst: true };
  const { until } = prefs;
  if (until === undefined || today < until || daysBetween(until, today) > CATCH_UP_DAYS) return undefined;
  return cards.some((c) => backlogged(c, until, dayStartsAtHour)) ? { paused: false, weakestFirst: true } : undefined;
}

/**
 * A deck's limits for the plan. A limit set for today alone (Custom Study) is the user's own ask,
 * so it stands; Light never raises a limit, and a share of a limit still allows one review.
 */
export function scaleLimits(limits: DeckLimits, plan: VacationPlan | undefined, custom: { new: boolean; review: boolean }): DeckLimits {
  if (!plan) return limits;
  const share = plan.reviewShare;
  return {
    newPerDay: plan.newPerDeck === undefined || custom.new ? limits.newPerDay : Math.min(limits.newPerDay, plan.newPerDeck),
    reviewsPerDay: share === undefined || custom.review || limits.reviewsPerDay <= 0 ? limits.reviewsPerDay : Math.max(1, Math.ceil(limits.reviewsPerDay * share)),
  };
}

/** What the deck list says about the vacation, or undefined when there's nothing to say. */
export type VacationNotice =
  | { kind: 'away'; mode: 'light' | 'paused'; until?: string }
  | { kind: 'back'; days: number };

export function vacationNotice(prefs: VacationPrefs | undefined, now: Date, dayStartsAtHour: number): VacationNotice | undefined {
  if (!prefs) return undefined;
  const today = studyDayKey(now, dayStartsAtHour);
  const mode = activeMode(prefs, today);
  if (mode !== 'off') return { kind: 'away', mode, until: prefs.until };
  const { from, until } = prefs;
  if (until === undefined || from === undefined || daysBetween(until, today) > WELCOME_BACK_DAYS || today < until) return undefined;
  return { kind: 'back', days: Math.max(1, daysBetween(from, until)) };
}
