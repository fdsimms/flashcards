import { dayKeyOf, nextStudyDayStart, studyDayStart } from './day';
import type { Card, ReviewLogEntry } from './types';

/**
 * Study statistics for a deck (with its subdecks) or the whole collection, as the Stats screen
 * shows them: today, the next days' workload, the past days' answers, cards by stage, and how
 * often reviews were remembered. Pure: the screen gathers the inputs.
 *
 * Answers come from two places. For a card from Anki, the kept collection's review log, which
 * holds its whole Anki history plus every answer given here (writeback.ts writes each one there).
 * For a card that exists only in Franki (a TSV import), Franki's own reviews table. Using both for
 * an Anki card would count each Franki answer twice.
 */

/** A card counts as mature from this interval on, as in Anki. */
export const MATURE_DAYS = 21;

export type AnswerKind = 'learn' | 'review' | 'relearn';

export interface Answer {
  cardId: string;
  at: Date;
  rating: 1 | 2 | 3 | 4;
  kind: AnswerKind;
  /** The card was new: this was its first answer. */
  wasNew: boolean;
  /** The interval in days before the answer, when known (Anki's review log has it; Franki's table doesn't). */
  lastIntervalDays?: number;
  takenMs: number;
}

/** An Anki review log row (`revlog`), as stats need it. */
export interface RevlogRow {
  id: number;
  cid: number;
  ease: number;
  lastIvl: number;
  time: number;
  type: number;
}

/** Every answer, from the review log for Anki's cards and Franki's table for the rest. */
export function answersFrom(input: { revlog: RevlogRow[]; reviews: ReviewLogEntry[]; cards: Card[] }): Answer[] {
  const byAnkiId = new Map<number, string>();
  const ankiCards = new Set<string>();
  for (const c of input.cards) {
    if (c.ankiId) { byAnkiId.set(Number(c.ankiId), c.id); ankiCards.add(c.id); }
  }
  const out: Answer[] = [];
  for (const r of input.revlog) {
    const cardId = byAnkiId.get(r.cid);
    // Ease 0 is a manual reschedule, not an answer, and types 4 and up are resets and reschedules.
    // Type 3 (a review in a filtered deck) counts as a review.
    if (!cardId || r.ease < 1 || r.ease > 4 || r.type > 3) continue;
    out.push({
      cardId,
      at: new Date(r.id),
      rating: r.ease as Answer['rating'],
      kind: r.type === 0 ? 'learn' : r.type === 2 ? 'relearn' : 'review',
      wasNew: r.type === 0 && r.lastIvl === 0,
      lastIntervalDays: r.lastIvl > 0 ? r.lastIvl : undefined,
      takenMs: r.time,
    });
  }
  for (const r of input.reviews) {
    if (ankiCards.has(r.cardId)) continue;
    out.push({
      cardId: r.cardId,
      at: new Date(r.reviewedAt),
      rating: r.rating,
      // The state the card was in when answered.
      kind: r.state === 2 ? 'review' : r.state === 3 ? 'relearn' : 'learn',
      wasNew: r.state === 0,
      takenMs: 0,
    });
  }
  return out;
}

export interface DayAnswers { key: string; start: Date; learn: number; review: number; relearn: number; takenMs: number }
export interface DayDue { key: string; start: Date; due: number }
export interface Rate { passed: number; total: number }

export interface Stats {
  today: { answered: number; takenMs: number; again: number; newCards: number };
  /** Study days up to today, oldest first. */
  past: DayAnswers[];
  /** Cards due before today's study day began, still waiting. */
  overdue: number;
  /** Today and the study days after it. Today counts what's due later today too. */
  forecast: DayDue[];
  counts: { new: number; learning: number; young: number; mature: number; suspended: number };
  /** Reviews remembered (anything but Again), over the last 7 and 30 study days. */
  retention: { week: Rate; month: Rate; matureMonth: Rate };
}

export function computeStats(input: { cards: Card[]; answers: Answer[]; now: Date; dayStartsAtHour: number; days: number }): Stats {
  const { now, dayStartsAtHour: h, days } = input;
  const todayStart = studyDayStart(now, h);

  // Study day starts: `days` back (ending today) and `days` ahead (starting today).
  const starts: Date[] = [todayStart];
  for (let i = 1; i < days; i++) {
    const prev = new Date(starts[0]);
    prev.setDate(prev.getDate() - 1);
    starts.unshift(prev);
  }
  const past: DayAnswers[] = starts.map((start) => ({ key: dayKeyOf(start), start, learn: 0, review: 0, relearn: 0, takenMs: 0 }));
  const pastIndex = new Map(past.map((d, i) => [d.key, i]));
  const forecast: DayDue[] = [];
  for (let d = todayStart, i = 0; i < days; i++, d = nextStudyDayStart(d, h)) forecast.push({ key: dayKeyOf(d), start: d, due: 0 });
  const forecastIndex = new Map(forecast.map((d, i) => [d.key, i]));
  const dayOf = (t: Date) => dayKeyOf(studyDayStart(t, h));

  const today = { answered: 0, takenMs: 0, again: 0, newCards: 0 };
  const weekStart = past[Math.max(0, past.length - 7)].start;
  const retention = { week: { passed: 0, total: 0 }, month: { passed: 0, total: 0 }, matureMonth: { passed: 0, total: 0 } };
  const answeredBefore = new Set<string>();
  const newToday = new Set<string>();
  const sorted = [...input.answers].sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const a of sorted) {
    const idx = pastIndex.get(dayOf(a.at));
    if (idx === undefined) { if (a.at < past[0].start) answeredBefore.add(a.cardId); continue; }
    const day = past[idx];
    day[a.kind]++;
    day.takenMs += a.takenMs;
    if (a.at >= todayStart) {
      today.answered++;
      today.takenMs += a.takenMs;
      if (a.rating === 1) today.again++;
      // New today: its first answer in the window, today, while it was new.
      if (a.wasNew && !answeredBefore.has(a.cardId)) newToday.add(a.cardId);
    }
    answeredBefore.add(a.cardId);
    if (a.kind === 'review') {
      const passed = a.rating > 1 ? 1 : 0;
      retention.month.total++; retention.month.passed += passed;
      if (a.at >= weekStart) { retention.week.total++; retention.week.passed += passed; }
      if ((a.lastIntervalDays ?? 0) >= MATURE_DAYS) { retention.matureMonth.total++; retention.matureMonth.passed += passed; }
    }
  }
  today.newCards = newToday.size;

  const counts = { new: 0, learning: 0, young: 0, mature: 0, suspended: 0 };
  let overdue = 0;
  for (const c of input.cards) {
    if (c.retired) continue;
    if (c.suspended) { counts.suspended++; continue; }
    const s = c.sched;
    if (s.state === 0) { counts.new++; continue; }
    if (s.state === 2) counts[s.scheduledDays >= MATURE_DAYS ? 'mature' : 'young']++;
    else counts.learning++;
    const due = new Date(s.due);
    if (due < todayStart) { overdue++; continue; }
    const fi = forecastIndex.get(dayOf(due));
    if (fi !== undefined) forecast[fi].due++;
  }

  return { today, past, overdue, forecast, counts, retention };
}

/** A share as a whole percent, or null with nothing to go on. */
export function percent(r: Rate): number | null {
  return r.total ? Math.round((r.passed / r.total) * 100) : null;
}

/**
 * Time spent, as the Stats screen says it: "under a minute", "12 min", "4 h 10 min". Joined with
 * no-break spaces, so a sentence never wraps it in the middle.
 */
export function durationText(ms: number): string {
  const minutes = Math.round(ms / 60000);
  const nb = (s: string) => s.replace(/ /g, '\u00a0');
  if (minutes < 1) return ms > 0 ? 'under a minute' : nb('0 min');
  if (minutes < 60) return nb(`${minutes} min`);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return nb(m ? `${h} h ${m} min` : `${h} h`);
}
