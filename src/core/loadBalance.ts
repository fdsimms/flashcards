import { balancedInterval, LOAD_BALANCE_DAYS, type Balancer } from './ankiFuzz';
import { studyDayStart } from './day';
import { isInterdayLearning } from './queue';
import type { Card } from './types';

/**
 * What Anki's load balancer works from (rslib scheduler/states/load_balancer.rs): a snapshot,
 * taken when a study session is built, of the cards on each of the next 99 days by preset, and
 * the days each note's cards are on. As in Anki, it counts every card whose stored due falls in
 * that window (a new card's position too, and suspended and buried cards), but none in a
 * filtered deck; an answered card is added at its new interval, and an undo takes the card out.
 */

interface LoadEntry { preset: number; noteId: string; days: number[] }
export type LoadSnapshot = Map<string, LoadEntry>;

const DAY = 86400000;

/** The day (from today) Anki's load balancer reads a card's due as, if it's in the window. */
export function loadDayIndex(card: Card, now: Date, dayStartsAtHour: number, ankiToday: number | undefined): number | undefined {
  if (card.filteredDeck || card.previewDue || card.retired) return undefined;
  let d: number | undefined;
  if (card.sched.state === 0) {
    // A new card's due is its position, which Anki's query doesn't tell apart from a day number.
    d = ankiToday !== undefined && card.position !== undefined ? card.position - ankiToday : undefined;
  } else if (card.sched.state === 2 || isInterdayLearning(card, dayStartsAtHour)) {
    const today = studyDayStart(now, dayStartsAtHour).getTime();
    d = Math.round((studyDayStart(new Date(card.sched.due), dayStartsAtHour).getTime() - today) / DAY);
  }
  return d !== undefined && d >= 0 && d < LOAD_BALANCE_DAYS ? d : undefined;
}

/** The snapshot of `cards`, each counted under its preset (`presetOf`) on its day (`dayOf`). */
export function buildLoadSnapshot(cards: Card[], presetOf: (c: Card) => number | undefined, dayOf: (c: Card) => number | undefined): LoadSnapshot {
  const snap: LoadSnapshot = new Map();
  for (const c of cards) {
    const preset = presetOf(c);
    const d = dayOf(c);
    if (preset !== undefined && d !== undefined) snap.set(c.id, { preset, noteId: c.noteId, days: [d] });
  }
  return snap;
}

/** An answered card, now a review `interval` days out, added to the snapshot as Anki's add_card does. */
export function recordAnswer(snap: LoadSnapshot, card: Card, preset: number | undefined, interval: number): void {
  if (preset === undefined || interval >= LOAD_BALANCE_DAYS) return;
  const entry = snap.get(card.id);
  if (entry) entry.days.push(interval);
  else snap.set(card.id, { preset, noteId: card.noteId, days: [interval] });
}

/** An undone answer's card, taken out of the snapshot on every day, as Anki's remove_card does. */
export function forgetCard(snap: LoadSnapshot, cardId: string): void {
  snap.delete(cardId);
}

/**
 * The load balancer for answering `card`, or undefined (plain fuzz) when its preset has no cards
 * in the window, as in Anki. Sibling days count only when the preset buries review siblings.
 */
export function balancerFor(snap: LoadSnapshot, card: Card, o: {
  preset: number | undefined; seed: bigint | undefined; easyDays?: number[]; buryReviews: boolean; nextDayAt: Date;
  /** The weekday (Monday 0) of the day `d` days on; by default in this device's time zone, as Anki reads it. */
  weekdayOf?: (d: number) => number;
}): Balancer | undefined {
  if (o.preset === undefined || o.seed === undefined) return undefined;
  const dayCounts = Array<number>(LOAD_BALANCE_DAYS).fill(0);
  const siblingDays: number[] = [];
  for (const e of snap.values()) {
    if (e.preset === o.preset) for (const d of e.days) dayCounts[d]++;
    if (o.buryReviews && e.noteId === card.noteId) siblingDays.push(...e.days);
  }
  if (!dayCounts.some((n) => n > 0)) return undefined;
  const seed = o.seed;
  // Monday 0, in this device's time zone, of the day `d` days on (Anki: next_day_at + (d - 1) days).
  const weekdayOf = o.weekdayOf ?? ((d: number) => (new Date(o.nextDayAt.getTime() + (d - 1) * DAY).getDay() + 6) % 7);
  return (iv, min, max) => balancedInterval(iv, min, max, {
    seed, dayCounts, weekdayOf, easyDays: o.easyDays, siblingDays: o.buryReviews ? siblingDays : undefined,
  });
}
