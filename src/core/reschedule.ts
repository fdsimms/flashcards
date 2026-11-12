import { nextStudyDayStart, studyDayStart } from './day';
import { newSchedState } from './scheduler';
import type { Card } from './types';

/**
 * Anki's Forget and Set Due Date, for a card that lives in Franki only (a TSV import's). A card
 * from the kept Anki collection is changed there instead, as Anki changes it
 * (src/anki/rescheduleWrites.ts), and read back the way an import reads it, so the two agree.
 */

/**
 * What Set Due Date asks for, as Anki reads it (rslib's `parse_due_date_str`): a number of days
 * from today, or a range picked from at random ("1-7"), with "!" to also reset the interval.
 */
export interface DueDateSpec {
  min: number;
  max: number;
  /** "!": the interval becomes the new delay rather than staying as it was. */
  forceReset: boolean;
}

/** Undefined when the text isn't one Anki would take. */
export function parseDueDate(text: string): DueDateSpec | undefined {
  const m = /^(\d+)(?:-(\d+))?(!)?$/.exec(text.trim());
  if (!m) return undefined;
  const a = Number(m[1]);
  const b = m[2] === undefined ? a : Number(m[2]);
  return { min: Math.min(a, b), max: Math.max(a, b), forceReset: !!m[3] };
}

/** A whole number of days in the spec's range, each equally likely, as Anki picks one per card. */
export function pickDays(spec: DueDateSpec, random: () => number = Math.random): number {
  return spec.min + Math.floor(random() * (spec.max - spec.min + 1));
}

const DAY_MS = 86_400_000;

/** The start of the study day `days` after the one `now` falls in, by the calendar (DST-safe). */
export function studyDayAfter(now: Date, days: number, dayStartsAtHour: number): Date {
  const d = studyDayStart(now, dayStartsAtHour);
  d.setDate(d.getDate() + days);
  d.setHours(dayStartsAtHour, 0, 0, 0);
  return d;
}

/**
 * Forget, as Anki's `schedule_as_new`: the card is new again, with its FSRS memory gone, out of
 * any bury or suspension (Anki puts it back in the new queue), and its review and lapse counts
 * kept unless `resetCounts`. A Franki-only card keeps its place in the new-card order.
 */
export function forgetCard(card: Card, opts: { resetCounts: boolean }, now: Date): Card {
  const sched = newSchedState(now);
  return {
    ...card,
    suspended: false,
    buriedAt: undefined,
    sched: { ...sched, reps: opts.resetCounts ? 0 : card.sched.reps, lapses: opts.resetCounts ? 0 : card.sched.lapses },
  };
}

/**
 * Set Due Date, as Anki's `Card::set_due_date` with FSRS on: the card becomes a review due at the
 * start of the study day `days` from today, keeping its memory state. Its interval becomes the
 * days since it was last answered plus `days` (Anki counts from the next day's start); a card
 * never answered gets the shortest interval, and its memory starts where an imported review
 * card's does (`schedFromAnki`: stability of its interval, middling difficulty).
 */
export function setDueCard(card: Card, days: number, now: Date, dayStartsAtHour: number): Card {
  const s = card.sched;
  const due = studyDayAfter(now, days, dayStartsAtHour);
  const fresh = s.state === 0 || !s.lastReview;
  const elapsed = s.lastReview
    ? Math.max(0, Math.floor((nextStudyDayStart(now, dayStartsAtHour).getTime() - new Date(s.lastReview).getTime()) / DAY_MS))
    : 0;
  const interval = Math.max(1, fresh ? 0 : elapsed + days);
  return {
    ...card,
    suspended: false,
    buriedAt: undefined,
    sched: {
      ...s,
      state: 2,
      due: due.toISOString(),
      scheduledDays: interval,
      learningSteps: 0,
      stability: fresh || s.stability <= 0 ? interval : s.stability,
      difficulty: fresh || s.difficulty <= 0 ? 5 : s.difficulty,
      lastReview: s.lastReview ?? new Date(due.getTime() - interval * DAY_MS).toISOString(),
    },
  };
}
