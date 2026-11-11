import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  type Card as FsrsCard,
  type Grade,
} from 'ts-fsrs';
import type { ReviewLogEntry, SchedState } from './types';

const engine = fsrs(generatorParameters({ enable_fuzz: true, request_retention: 0.9 }));

export type RatingValue = 1 | 2 | 3 | 4;

function toFsrs(s: SchedState): FsrsCard {
  return {
    due: new Date(s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: s.elapsedDays,
    scheduled_days: s.scheduledDays,
    learning_steps: s.learningSteps,
    reps: s.reps,
    lapses: s.lapses,
    state: s.state,
    last_review: s.lastReview ? new Date(s.lastReview) : undefined,
  };
}

function fromFsrs(c: FsrsCard): SchedState {
  return {
    due: c.due.toISOString(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsedDays: c.elapsed_days,
    scheduledDays: c.scheduled_days,
    learningSteps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    lastReview: c.last_review ? c.last_review.toISOString() : null,
  };
}

export function newSchedState(now: Date = new Date()): SchedState {
  return fromFsrs(createEmptyCard(now));
}

export interface ReviewResult {
  sched: SchedState;
  log: Omit<ReviewLogEntry, 'cardId'>;
}

export function review(sched: SchedState, rating: RatingValue, now: Date = new Date()): ReviewResult {
  const { card, log } = engine.next(toFsrs(sched), now, rating as Grade);
  return {
    sched: fromFsrs(card),
    log: {
      rating,
      reviewedAt: now.toISOString(),
      state: log.state,
      due: log.due.toISOString(),
      stability: log.stability,
      difficulty: log.difficulty,
    },
  };
}

/** Human-readable next interval for each rating, e.g. { 1: '1m', 2: '6m', 3: '10m', 4: '4d' }. */
export function previewIntervals(sched: SchedState, now: Date = new Date()): Record<RatingValue, string> {
  const rec = engine.repeat(toFsrs(sched), now);
  const out = {} as Record<RatingValue, string>;
  for (const r of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as const) {
    out[r as RatingValue] = formatInterval(rec[r].card.due.getTime() - now.getTime());
  }
  return out;
}

export function formatInterval(ms: number): string {
  const min = ms / 60000;
  if (min < 1) return '<1m';
  if (min < 60) return `${Math.round(min)}m`;
  const h = min / 60;
  if (h < 24) return `${Math.round(h)}h`;
  const d = h / 24;
  if (d < 30) return `${Math.round(d)}d`;
  if (d < 365) return `${(d / 30).toFixed(1).replace(/\.0$/, '')}mo`;
  return `${(d / 365).toFixed(1).replace(/\.0$/, '')}y`;
}
