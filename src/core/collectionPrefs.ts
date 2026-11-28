import type { CollectionSettings } from './types';

/**
 * Anki's collection-wide scheduling preferences, as Settings, Decks and cards, Scheduling edits
 * them: the same values `CollectionSettings` reads from the collection's config, in the units the
 * screen shows (minutes rather than Anki's seconds). They apply to every deck and, once synced, to
 * Anki on every device; src/anki/collectionPrefsService.ts writes them.
 */
export interface CollectionPrefs {
  /** "Next day starts at": the hour (0-23) a study day starts (Anki's `rollover`). */
  dayStartsAtHour: number;
  /** "Learn ahead limit", in minutes (Anki's `collapseTime`, in seconds). */
  learnAheadMinutes: number;
  /** The session time limit, in minutes; 0 is off (Anki's `timeLim`, in seconds). */
  timeLimitMinutes: number;
  newCardsIgnoreReviewLimit: boolean;
  applyAllParentLimits: boolean;
  loadBalancer: boolean;
}

/** The most minutes either number field takes, so a slip of the finger can't ask for days. */
export const PREF_MINUTES_MAX = 9999;

export function prefsOf(cs: CollectionSettings): CollectionPrefs {
  return {
    dayStartsAtHour: cs.dayStartsAtHour,
    learnAheadMinutes: Math.round(cs.learnAheadMinutes),
    timeLimitMinutes: Math.round((cs.timeLimitSecs ?? 0) / 60),
    newCardsIgnoreReviewLimit: cs.newCardsIgnoreReviewLimit,
    applyAllParentLimits: cs.applyAllParentLimits,
    loadBalancer: cs.loadBalancer ?? true,
  };
}

/** The settings Franki schedules with once `change` is saved. */
export function withPrefs(cs: CollectionSettings, change: Partial<CollectionPrefs>): CollectionSettings {
  const next: CollectionSettings = { ...cs };
  if (change.dayStartsAtHour !== undefined) next.dayStartsAtHour = change.dayStartsAtHour;
  if (change.learnAheadMinutes !== undefined) next.learnAheadMinutes = change.learnAheadMinutes;
  if (change.timeLimitMinutes !== undefined) {
    if (change.timeLimitMinutes > 0) next.timeLimitSecs = change.timeLimitMinutes * 60;
    else delete next.timeLimitSecs;
  }
  if (change.newCardsIgnoreReviewLimit !== undefined) next.newCardsIgnoreReviewLimit = change.newCardsIgnoreReviewLimit;
  if (change.applyAllParentLimits !== undefined) next.applyAllParentLimits = change.applyAllParentLimits;
  if (change.loadBalancer !== undefined) next.loadBalancer = change.loadBalancer;
  return next;
}

/** A whole number of minutes typed into a field, or the reason it can't be saved. */
export function parseMinutes(text: string): { minutes: number } | { error: string } {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return { error: 'Enter a whole number of minutes.' };
  const minutes = Number(t);
  if (minutes > PREF_MINUTES_MAX) return { error: `Enter ${PREF_MINUTES_MAX} minutes or fewer.` };
  return { minutes };
}

/** The reason `change` can't be saved, or undefined. */
export function prefsProblem(change: Partial<CollectionPrefs>): string | undefined {
  const h = change.dayStartsAtHour;
  if (h !== undefined && !(Number.isInteger(h) && h >= 0 && h <= 23)) return 'The next day has to start on an hour from midnight to 11 PM.';
  for (const m of [change.learnAheadMinutes, change.timeLimitMinutes]) {
    if (m !== undefined && !(Number.isInteger(m) && m >= 0 && m <= PREF_MINUTES_MAX)) return `Enter a whole number of minutes from 0 to ${PREF_MINUTES_MAX}.`;
  }
  return undefined;
}
