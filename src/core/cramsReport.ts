// What Franki tells its server about its crams for dundundun: each open cram's name, day, when its
// day ends, when it was last practiced and whether it's finished, so dundundun can write a practice
// task each day a cram runs and a "check off the words you used" task once its day is over, the way
// Franki's own Today cards do (src/ui/cram/CramCards.tsx). Sent while Read & Listen is on and its
// "Share today's counts and crams" setting is (src/reader/prefs.ts), from useCramsReport. Pure, so it's tested.

import { cramEnd, type Cram } from './cram';
import { studyDayStart } from './day';

/** One cram as the server keeps it (`PUT /api/franki-crams`), field names as the server's. */
export interface CramReport {
  id: string;
  name: string;
  /** Its day, `YYYY-MM-DD`. */
  date: string;
  /** When its day ends (the start of the study day after it), ISO: practice runs until then. */
  ends_at: string;
  /** When its latest practice round ended, ISO, or null before the first. */
  practiced_at: string | null;
  /** When At the lesson's Finish was pressed, ISO, or null while it isn't. */
  finished_at: string | null;
}

/** The most crams sent, the soonest first; the server refuses more. */
export const MAX_REPORTED_CRAMS = 50;

/**
 * The crams to send: every one not finished, and one finished since the current study day began, so
 * dundundun's check-off task can read as done for the rest of that day before it goes. A cram
 * finished before today, or deleted, is left out, which is how dundundun learns it's gone.
 */
export function cramsReport(crams: readonly Cram[], now: Date, dayStartsAtHour: number): CramReport[] {
  const dayStart = studyDayStart(now, dayStartsAtHour).getTime();
  return crams
    .filter((c) => !c.finishedAt || new Date(c.finishedAt).getTime() >= dayStart)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    .slice(0, MAX_REPORTED_CRAMS)
    .map((c) => ({
      id: c.id,
      name: c.name,
      date: c.date,
      ends_at: cramEnd(c, dayStartsAtHour).toISOString(),
      practiced_at: lastPracticed(c),
      finished_at: c.finishedAt ?? null,
    }));
}

function lastPracticed(cram: Cram): string | null {
  let latest: string | null = null;
  for (const r of cram.rounds) if (!latest || new Date(r.finishedAt) > new Date(latest)) latest = r.finishedAt;
  return latest;
}
