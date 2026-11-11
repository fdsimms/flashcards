import { nextStudyDayStart } from './day';
import type { Card } from './types';

export interface QueueOptions {
  newPerDay: number;
  /** New cards already introduced this study day (counts against newPerDay). */
  newIntroducedToday?: number;
  /** The hour the study day starts (`DAY_STARTS_AT_HOUR`). */
  dayStartsAtHour: number;
  now?: Date;
}

export interface Queue {
  due: Card[];
  fresh: Card[];
}

/**
 * Whether a card that has been studied is due now.
 *
 * A Review card is due for its whole study day, as in Anki: its due instant carries the time of
 * day it was last answered, so read as an instant, a card answered at 9 PM yesterday with a
 * one-day interval would stay hidden until 9 PM today. A Learning or Relearning card is due at
 * its exact instant, since its steps are minutes apart.
 */
export function isDue(card: Card, now: Date, dayStartsAtHour: number): boolean {
  if (card.sched.state === 0) return false;
  const due = new Date(card.sched.due).getTime();
  if (card.sched.state === 2) return due < nextStudyDayStart(now, dayStartsAtHour).getTime();
  return due <= now.getTime();
}

/**
 * Due reviews/learning first (most overdue first), then up to the daily limit of new cards.
 *
 * The deck list's counts come from this too (`summarizeDecks`), so what a deck says it has
 * waiting is what opening it shows.
 */
export function buildQueue(cards: Card[], opts: QueueOptions): Queue {
  const now = opts.now ?? new Date();
  const active = cards.filter((c) => !c.suspended);
  const due = active
    .filter((c) => isDue(c, now, opts.dayStartsAtHour))
    .sort((a, b) => new Date(a.sched.due).getTime() - new Date(b.sched.due).getTime());
  const budget = Math.max(0, opts.newPerDay - (opts.newIntroducedToday ?? 0));
  const fresh = active.filter((c) => c.sched.state === 0).slice(0, budget);
  return { due, fresh };
}

export function nextCard(q: Queue): Card | undefined {
  return q.due[0] ?? q.fresh[0];
}
