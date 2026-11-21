import { dayKeyOf, nextStudyDayStart, studyDayStart } from './day';
import type { Card, ReviewLogEntry } from './types';

/**
 * Study statistics for a deck (with its subdecks) or the whole collection, as the Stats screen
 * shows them: today, the next days' workload, the past days' answers, a year's calendar of answers,
 * cards by stage and by interval, and how often reviews were remembered. Pure: the screen gathers
 * the inputs.
 *
 * Young and mature answers are told apart by the interval before the answer (`lastIntervalDays`,
 * from 21 days on), as Anki's graphs do. Franki's own table doesn't keep it, so a review of a card
 * only Franki has counts as young.
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
  /** An answer to a learning step that had crossed into a later day (Anki's queue 3): it counts as a review. */
  interday?: boolean;
  /** An answer in a filtered deck that only previews (review log type 3): it uses no deck's limits. */
  preview?: boolean;
  /** The deck it was given in, when Franki logged it (`ReviewLogEntry.deck`). */
  deck?: string;
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

/**
 * Every answer, from the review log for Anki's cards and Franki's table for the rest, and for an
 * Anki card's answer Franki has that the review log doesn't (its Anki write failed: "it counts in
 * Franki").
 */
export function answersFrom(input: { revlog: RevlogRow[]; reviews: ReviewLogEntry[]; cards: Card[] }): Answer[] {
  const byAnkiId = new Map<number, string>();
  const ankiCards = new Set<string>();
  for (const c of input.cards) {
    if (c.ankiId) { byAnkiId.set(Number(c.ankiId), c.id); ankiCards.add(c.id); }
  }
  // Where Franki answered an Anki card: its own log row for the answer, which has the deck the
  // review log lacks. The review log row is stamped with the answer's time in ms
  // (`nextRevlogId`, a little later only when two answers share a millisecond).
  const answeredIn = new Map<string, { at: number; deck: string }[]>();
  for (const r of input.reviews) {
    if (r.deck && ankiCards.has(r.cardId)) (answeredIn.get(r.cardId) ?? answeredIn.set(r.cardId, []).get(r.cardId)!).push({ at: Date.parse(r.reviewedAt), deck: r.deck });
  }
  const deckOf = (cardId: string, revlogId: number) => answeredIn.get(cardId)?.find((f) => revlogId >= f.at && revlogId - f.at < 1000)?.deck;
  // The review log's rows for each of Franki's Anki cards, to tell which of Franki's answers it has.
  const logged = new Map<string, number[]>();
  for (const r of input.revlog) {
    const cardId = byAnkiId.get(r.cid);
    if (cardId) (logged.get(cardId) ?? logged.set(cardId, []).get(cardId)!).push(r.id);
  }
  const inLog = (cardId: string, at: number) => !!logged.get(cardId)?.some((id) => id >= at && id - at < 1000);
  const out: Answer[] = [];
  for (const r of input.revlog) {
    const cardId = byAnkiId.get(r.cid);
    // Ease 0 is a manual reschedule, not an answer, and types 4 and up are resets and reschedules.
    // Type 3 (a preview in a filtered deck) counts as a review here; `preview` marks it for limits.
    if (!cardId || r.ease < 1 || r.ease > 4 || r.type > 3) continue;
    out.push({
      cardId,
      at: new Date(r.id),
      rating: r.ease as Answer['rating'],
      kind: r.type === 0 ? 'learn' : r.type === 2 ? 'relearn' : 'review',
      wasNew: r.type === 0 && r.lastIvl === 0,
      lastIntervalDays: r.lastIvl > 0 ? r.lastIvl : undefined,
      interday: (r.type === 0 || r.type === 2) && r.lastIvl > 0,
      preview: r.type === 3,
      deck: deckOf(cardId, r.id),
      takenMs: r.time,
    });
  }
  for (const r of input.reviews) {
    if (ankiCards.has(r.cardId) && inLog(r.cardId, Date.parse(r.reviewedAt))) continue;
    out.push({
      cardId: r.cardId,
      at: new Date(r.reviewedAt),
      rating: r.rating,
      // The state the card was in when answered.
      kind: r.state === 2 ? 'review' : r.state === 3 ? 'relearn' : 'learn',
      wasNew: r.state === 0,
      interday: !!r.interday,
      deck: r.deck,
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
}

export function computeStats(input: { cards: Card[]; answers: Answer[]; now: Date; dayStartsAtHour: number; days: number }): Stats {
  const { now, dayStartsAtHour: h, days } = input;
  const todayStart = studyDayStart(now, h);

  // Study day starts: `days` back (ending today) and `days` ahead (starting today).
  const starts: Date[] = [todayStart];
  for (let i = 1; i < days; i++) {
    // Built from today's date each time, not stepped back from the day before: where the start hour
    // doesn't exist on a spring-forward day, that day's start lands an hour late and every earlier
    // start stepped from it would keep the wrong hour.
    starts.unshift(new Date(todayStart.getFullYear(), todayStart.getMonth(), todayStart.getDate() - i, h));
  }
  const past: DayAnswers[] = starts.map((start) => ({ key: dayKeyOf(start), start, learn: 0, review: 0, relearn: 0, takenMs: 0 }));
  const pastIndex = new Map(past.map((d, i) => [d.key, i]));
  const forecast: DayDue[] = [];
  for (let d = todayStart, i = 0; i < days; i++, d = nextStudyDayStart(d, h)) forecast.push({ key: dayKeyOf(d), start: d, due: 0 });
  const forecastIndex = new Map(forecast.map((d, i) => [d.key, i]));
  const dayOf = (t: Date) => dayKeyOf(studyDayStart(t, h));

  const today = { answered: 0, takenMs: 0, again: 0, newCards: 0 };
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

  return { today, past, overdue, forecast, counts };
}

/** How many study days the calendar covers, ending today: a year, as Anki's Calendar shows. */
export const CALENDAR_DAYS = 365;

export interface CalendarDay {
  key: string;
  start: Date;
  answers: number;
  /** How dark the day is drawn: 0 for no answers, else 1 (fewest) to 4 (most). */
  level: 0 | 1 | 2 | 3 | 4;
}

export interface Calendar {
  /**
   * Weeks, oldest first, each Sunday to Saturday by the weekday of the study day's date. A slot
   * before the first day or after today is null.
   */
  weeks: (CalendarDay | null)[][];
  /** Study days covered, today included. */
  days: number;
  /** Days with at least one answer. */
  studied: number;
  total: number;
  /** The day with the most answers (the latest of a tie), or null with none. */
  busiest: CalendarDay | null;
}

/** The first study day the calendar shows: answers before it don't need loading. */
export function calendarStart(now: Date, dayStartsAtHour: number, days = CALENDAR_DAYS): Date {
  const start = studyDayStart(now, dayStartsAtHour);
  // setDate rather than subtracting hours, so a DST change doesn't shift the hour.
  start.setDate(start.getDate() - (days - 1));
  return start;
}

/**
 * Answers per study day over the last `days` study days, laid out as Anki's Calendar draws them:
 * a column per week. Every kind of answer counts (learning, review, relearning). A day's shade is
 * its rank among the days studied, in quarters, so one very long day doesn't wash out the rest.
 */
export function answerCalendar(input: { answers: Answer[]; now: Date; dayStartsAtHour: number; days?: number }): Calendar {
  const { now, dayStartsAtHour: h, days = CALENDAR_DAYS } = input;
  const all: CalendarDay[] = [];
  for (let d = calendarStart(now, h, days), i = 0; i < days; i++, d = nextStudyDayStart(d, h)) {
    all.push({ key: dayKeyOf(d), start: d, answers: 0, level: 0 });
  }
  const index = new Map(all.map((d, i) => [d.key, i]));
  for (const a of input.answers) {
    const i = index.get(dayKeyOf(studyDayStart(a.at, h)));
    if (i !== undefined) all[i].answers++;
  }

  // Rank each count among the studied days; a tie takes its highest rank, so a run of equal days
  // all draw at the same shade.
  const counts = all.map((d) => d.answers).filter((n) => n > 0).sort((a, b) => a - b);
  const rank = new Map<number, number>();
  counts.forEach((n, i) => rank.set(n, i + 1));
  let total = 0;
  let busiest: CalendarDay | null = null;
  for (const d of all) {
    if (!d.answers) continue;
    d.level = Math.max(1, Math.ceil((4 * rank.get(d.answers)!) / counts.length)) as CalendarDay['level'];
    total += d.answers;
    if (!busiest || d.answers >= busiest.answers) busiest = d;
  }

  const weeks: (CalendarDay | null)[][] = [];
  let week: (CalendarDay | null)[] = Array.from({ length: all[0].start.getDay() }, () => null);
  for (const d of all) {
    week.push(d);
    if (week.length === 7) { weeks.push(week); week = []; }
  }
  if (week.length) weeks.push([...week, ...Array.from({ length: 7 - week.length }, () => null)]);
  return { weeks, days, studied: counts.length, total, busiest };
}

/**
 * Review intervals in groups a phone's width can show: a day at a time for the first few days, as
 * Anki's Card Intervals graph does, then weeks, months and years. `max` is inclusive. Mature
 * (MATURE_DAYS) starts a group, so the young and mature cards never share a bar.
 */
export const INTERVAL_GROUPS: readonly { label: string; max: number }[] = [
  { label: '1 day', max: 1 },
  { label: '2 days', max: 2 },
  { label: '3 days', max: 3 },
  { label: '4 to 6 days', max: 6 },
  { label: '1 to 2 weeks', max: 13 },
  { label: '2 to 3 weeks', max: MATURE_DAYS - 1 },
  { label: '3 weeks to a month', max: 30 },
  { label: '1 to 2 months', max: 60 },
  { label: '2 to 3 months', max: 91 },
  { label: '3 to 6 months', max: 182 },
  { label: '6 months to a year', max: 365 },
  { label: '1 to 2 years', max: 730 },
  { label: 'Over 2 years', max: Infinity },
];

export interface Intervals {
  groups: { label: string; cards: number }[];
  /** Cards counted: in review, not suspended or retired (the young and mature counts together). */
  total: number;
  /** In days; 0 with no cards. */
  average: number;
  longest: number;
}

/** How many review cards have each interval: the gap in days their last answer set. */
export function intervalGroups(cards: Card[]): Intervals {
  const groups = INTERVAL_GROUPS.map((g) => ({ label: g.label, cards: 0 }));
  let total = 0;
  let sum = 0;
  let longest = 0;
  for (const c of cards) {
    if (c.retired || c.suspended || c.sched.state !== 2) continue;
    const days = Math.max(1, Math.round(c.sched.scheduledDays));
    groups[INTERVAL_GROUPS.findIndex((g) => days <= g.max)].cards++;
    total++;
    sum += days;
    longest = Math.max(longest, days);
  }
  return { groups, total, average: total ? sum / total : 0, longest };
}

/** An interval as people say it: "12 days", "3 months", "1.5 years". */
export function intervalText(days: number): string {
  const d = Math.round(days);
  if (d < 31) return d === 1 ? '1 day' : `${d} days`;
  if (d < 365) {
    const m = Math.round(d / 30.44);
    return m === 1 ? '1 month' : `${m} months`;
  }
  const y = Math.round(d / 36.525) / 10;
  return y === 1 ? '1 year' : `${y} years`;
}

/** A share as a whole percent, or null with nothing to go on. */
export function percent(r: Rate): number | null {
  return r.total ? Math.round((r.passed / r.total) * 100) : null;
}

/**
 * Time spent, as the Stats screen says it: "< 1 min", "12 min", "4 h 10 min". Joined with
 * no-break spaces, so a sentence never wraps it in the middle.
 */
export function durationText(ms: number): string {
  const minutes = Math.round(ms / 60000);
  const nb = (s: string) => s.replace(/ /g, '\u00a0');
  if (minutes < 1) return ms > 0 ? nb('< 1 min') : nb('0 min');
  if (minutes < 60) return nb(`${minutes} min`);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return nb(m ? `${h} h ${m} min` : `${h} h`);
}

/** How far back the answer buttons and the hours of the day look, in study days ending today. */
export const STATS_RANGES: readonly { days: number; label: string }[] = [
  { days: 30, label: '1 month' },
  { days: 91, label: '3 months' },
  { days: CALENDAR_DAYS, label: '1 year' },
];

/** Answered while in a review (not a learning step), the interval before it 21 days or more. */
const isMature = (a: Answer) => (a.lastIntervalDays ?? 0) >= MATURE_DAYS;

/**
 * Answers a graph about remembering counts: every one but a filtered deck's preview, which only
 * shows the card (Anki's graphs leave its review log type out too).
 */
const counted = (a: Answer) => !a.preview;

export interface ButtonCounts {
  /** Again, Hard, Good, Easy. */
  pressed: [number, number, number, number];
  total: number;
  /** Anything but Again. */
  passed: number;
}

export interface AnswerButtons { learning: ButtonCounts; young: ButtonCounts; mature: ButtonCounts }

/**
 * How often each answer button was pressed since `since`, as Anki's Answer Buttons graph splits
 * them: learning and relearning steps (a step crossed into a later day included), then reviews of
 * young and of mature cards.
 */
export function answerButtons(input: { answers: Answer[]; since: Date }): AnswerButtons {
  const blank = (): ButtonCounts => ({ pressed: [0, 0, 0, 0], total: 0, passed: 0 });
  const out: AnswerButtons = { learning: blank(), young: blank(), mature: blank() };
  for (const a of input.answers) {
    if (a.at < input.since || !counted(a)) continue;
    const group = out[a.kind !== 'review' ? 'learning' : isMature(a) ? 'mature' : 'young'];
    group.pressed[a.rating - 1]++;
    group.total++;
    if (a.rating > 1) group.passed++;
  }
  return out;
}

export interface HourAnswers {
  /** The hour of the day on the clock, 0 to 23. */
  hour: number;
  total: number;
  /** Anything but Again. */
  passed: number;
}

/**
 * Answers since `since` by the hour of the day they were given, with how many weren't Again, as
 * Anki's Hourly Breakdown shows. Every kind of answer counts. The 24 hours run from the hour the
 * study day starts, so a late night sits at the end of the day it belongs to.
 */
export function answersByHour(input: { answers: Answer[]; since: Date; dayStartsAtHour: number }): HourAnswers[] {
  const out: HourAnswers[] = Array.from({ length: 24 }, (_, i) => ({ hour: (input.dayStartsAtHour + i) % 24, total: 0, passed: 0 }));
  for (const a of input.answers) {
    if (a.at < input.since || !counted(a)) continue;
    const h = out[(a.at.getHours() - input.dayStartsAtHour + 24) % 24];
    h.total++;
    if (a.rating > 1) h.passed++;
  }
  return out;
}

export interface RetentionRow { label: string; young: Rate; mature: Rate; all: Rate }

/**
 * Anki's True Retention table: reviews not answered Again, young and mature apart, today,
 * yesterday, and over the last week, month and year of study days. Learning and relearning steps
 * aren't counted, nor are previews.
 */
export function trueRetention(input: { answers: Answer[]; now: Date; dayStartsAtHour: number }): RetentionRow[] {
  const { now, dayStartsAtHour: h } = input;
  const today = studyDayStart(now, h);
  const periods: { label: string; from: Date; to?: Date }[] = [
    { label: 'Today', from: today },
    { label: 'Yesterday', from: calendarStart(now, h, 2), to: today },
    { label: 'Last 7 days', from: calendarStart(now, h, 7) },
    { label: 'Last 30 days', from: calendarStart(now, h, 30) },
    { label: 'Last year', from: calendarStart(now, h, CALENDAR_DAYS) },
  ];
  const rows = periods.map((p) => ({ label: p.label, young: { passed: 0, total: 0 }, mature: { passed: 0, total: 0 }, all: { passed: 0, total: 0 } }));
  for (const a of input.answers) {
    if (a.kind !== 'review' || !counted(a)) continue;
    const passed = a.rating > 1 ? 1 : 0;
    periods.forEach((p, i) => {
      if (a.at < p.from || (p.to && a.at >= p.to)) return;
      for (const r of [rows[i][isMature(a) ? 'mature' : 'young'], rows[i].all]) { r.total++; r.passed += passed; }
    });
  }
  return rows;
}

export interface Streaks {
  /**
   * Study days in a row with an answer, up to today. Today not studied yet doesn't end it: it
   * then counts up to yesterday.
   */
  current: number;
  /** The longest run in the calendar's days. */
  longest: number;
}

/** Days studied in a row, from the calendar's days (so no further back than it reaches). */
export function answerStreaks(calendar: Calendar): Streaks {
  const days = calendar.weeks.flat().filter((d): d is CalendarDay => d !== null);
  let longest = 0;
  let run = 0;
  for (const d of days) {
    run = d.answers ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  let current = 0;
  for (let i = days.length - 1 - (days.at(-1)?.answers ? 0 : 1); i >= 0 && days[i].answers; i--) current++;
  return { current, longest };
}

/**
 * The subdecks Stats offers under a chosen scope: for the scope and each deck above it, its own
 * subdecks (full names, sorted), so the screen shows a row per level down to the deck chosen. A
 * level with no subdecks has no row; with no scope, there's none.
 */
export function subdeckLevels(decks: string[], scope: string | null): { parent: string; children: string[] }[] {
  if (scope === null) return [];
  const parts = scope.split('::');
  const out: { parent: string; children: string[] }[] = [];
  for (let i = 1; i <= parts.length; i++) {
    const parent = parts.slice(0, i).join('::');
    const children = new Set<string>();
    for (const d of decks) {
      if (!d.startsWith(`${parent}::`)) continue;
      children.add(`${parent}::${d.slice(parent.length + 2).split('::')[0]}`);
    }
    if (children.size) out.push({ parent, children: [...children].sort((a, b) => a.localeCompare(b)) });
  }
  return out;
}
