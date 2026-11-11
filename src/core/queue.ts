import type { Card } from './types';

export interface QueueOptions {
  newPerDay: number;
  /** New cards already introduced today (counts against newPerDay). */
  newIntroducedToday?: number;
  now?: Date;
}

export interface Queue {
  due: Card[];
  fresh: Card[];
}

/** Due reviews/learning first (most overdue first), then up to the daily limit of new cards. */
export function buildQueue(cards: Card[], opts: QueueOptions): Queue {
  const now = (opts.now ?? new Date()).getTime();
  const active = cards.filter((c) => !c.suspended);
  const due = active
    .filter((c) => c.sched.state !== 0 && new Date(c.sched.due).getTime() <= now)
    .sort((a, b) => new Date(a.sched.due).getTime() - new Date(b.sched.due).getTime());
  const budget = Math.max(0, opts.newPerDay - (opts.newIntroducedToday ?? 0));
  const fresh = active.filter((c) => c.sched.state === 0).slice(0, budget);
  return { due, fresh };
}

export function nextCard(q: Queue): Card | undefined {
  return q.due[0] ?? q.fresh[0];
}
