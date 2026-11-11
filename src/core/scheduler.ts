import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  type Card as FsrsCard,
  type Grade,
} from 'ts-fsrs';
import type { DeckParams, ReviewLogEntry, SchedState } from './types';

type Engine = ReturnType<typeof fsrs>;

/**
 * The engines are pure FSRS: memory state and review intervals, with no learning steps. Anki's
 * steps are applied on top (`stepOutcome`), since ts-fsrs's differ from Anki's: it graduates a
 * card on any step of a day or more, and its Hard repeats the first step's rule at every step.
 */
const NO_STEPS = { learning_steps: [] as [], relearning_steps: [] as [] };
const defaultEngine = fsrs(generatorParameters({ enable_fuzz: true, request_retention: 0.9, ...NO_STEPS }));
const engines = new Map<string, Engine>();

/**
 * The FSRS engine for a deck's settings, or the defaults with none. Built once per distinct
 * settings, since the review screen asks for one on every render.
 */
function engineFor(params?: DeckParams): Engine {
  if (!params) return defaultEngine;
  const key = JSON.stringify(params);
  let e = engines.get(key);
  if (!e) {
    e = fsrs(generatorParameters({
      enable_fuzz: true,
      // ts-fsrs migrates FSRS-5 (19) weights to FSRS-6 (21) itself. An empty list means Anki never
      // optimized the preset: leave w out so ts-fsrs uses its defaults rather than warning.
      w: params.weights.length ? params.weights : undefined,
      request_retention: params.desiredRetention,
      maximum_interval: params.maxInterval,
      ...NO_STEPS,
    }));
    engines.set(key, e);
  }
  return e;
}

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

/** Anki's default leech settings, for a deck with no preset: 8 lapses, tag only. */
export const DEFAULT_LEECH = { threshold: 8, suspend: false };

/**
 * Whether an answer made the card a leech, as Anki decides (rslib states/review.rs): a review
 * forgotten, bringing its lapses to the threshold, and again every half-threshold after that
 * (8, 12, 16... by default).
 */
export function becameLeech(before: SchedState, after: SchedState, leech: { threshold: number } = DEFAULT_LEECH): boolean {
  if (before.state !== 2 || after.lapses <= before.lapses) return false;
  const t = leech.threshold;
  const n = after.lapses;
  return t > 0 && n >= t && (n - t) % Math.max(Math.ceil(t / 2), 1) === 0;
}

/** Anki's default steps, when a deck has no preset: learn 1m 10m, relearn 10m. */
export const DEFAULT_LEARN_STEPS = [1, 10];
export const DEFAULT_RELEARN_STEPS = [10];

const DAY_SECS = 86400;
/** A step's length in seconds, as Anki computes it (f32 minutes times 60, truncated). */
const stepSecs = (steps: number[], i: number) => Math.trunc(Math.fround(steps[i]) * 60);
const roundDays = (secs: number) => (secs > DAY_SECS ? Math.round(secs / DAY_SECS) * DAY_SECS : secs);

/**
 * Where an answer on learning or relearning step `index` of `steps` (minutes) sends a card, as
 * Anki's steps do (rslib scheduler/states/steps.rs): Again to the first step; Hard repeats the
 * current step, or on the first step waits between it and the next (half again as long with one
 * step, at most a day more); Good to the next step; Easy, or Good on the last step, graduates.
 */
export function stepOutcome(steps: number[], index: number, rating: RatingValue): { secs: number; index: number } | 'graduate' {
  const len = steps.length;
  if (!len) return 'graduate';
  const i = Math.min(Math.max(index, 0), len - 1);
  if (rating === 1) return { secs: stepSecs(steps, 0), index: 0 };
  if (rating === 2) {
    if (i > 0) return { secs: stepSecs(steps, i), index: i };
    const first = stepSecs(steps, 0);
    const secs = len > 1 ? Math.floor((first + stepSecs(steps, 1)) / 2) : Math.min(Math.floor((first * 3) / 2), first + DAY_SECS);
    return { secs: roundDays(secs), index: 0 };
  }
  if (rating === 3 && i + 1 < len) return { secs: stepSecs(steps, i + 1), index: i + 1 };
  return 'graduate';
}

/**
 * Answers a card. FSRS updates its memory state and gives a graduating or review interval; the
 * deck's own learning and relearning steps (its Anki preset's, else Anki's defaults) decide
 * whether it waits on a step instead. A step of a day or more stays a learning step, as in Anki.
 */
export function review(sched: SchedState, rating: RatingValue, now: Date = new Date(), params?: DeckParams): ReviewResult {
  const { card, log } = engineFor(params).next(toFsrs(sched), now, rating as Grade);
  let next = fromFsrs(card);
  const learn = params?.learnSteps ?? DEFAULT_LEARN_STEPS;
  const relearn = params?.relearnSteps ?? DEFAULT_RELEARN_STEPS;
  // A new or learning card follows the learning steps; a relearning card, or a review forgotten, the relearning steps.
  const ladder = sched.state === 0 || sched.state === 1 ? { steps: learn, index: sched.state === 0 ? 0 : sched.learningSteps, state: 1 }
    : sched.state === 3 ? { steps: relearn, index: sched.learningSteps, state: 3 }
    : rating === 1 ? { steps: relearn, index: 0, state: 3 }
    : undefined;
  const step = ladder ? stepOutcome(ladder.steps, ladder.index, rating) : 'graduate';
  if (ladder && step !== 'graduate') {
    next = { ...next, state: ladder.state, due: new Date(now.getTime() + step.secs * 1000).toISOString(), scheduledDays: 0, learningSteps: step.index };
  }
  return {
    sched: next,
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

/** The log entry for an answer in a filtered deck that only previews: the card's schedule as it was. */
export function previewLog(card: { sched: SchedState }, rating: RatingValue, now: Date): ReviewResult['log'] {
  const s = card.sched;
  return { rating, reviewedAt: now.toISOString(), state: s.state, due: s.due, stability: s.stability, difficulty: s.difficulty };
}

/** Human-readable next interval for each rating, e.g. { 1: '1m', 2: '6m', 3: '10m', 4: '4d' }. */
export function previewIntervals(sched: SchedState, now: Date = new Date(), params?: DeckParams): Record<RatingValue, string> {
  const out = {} as Record<RatingValue, string>;
  for (const r of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as const) {
    out[r as RatingValue] = formatInterval(new Date(review(sched, r as RatingValue, now, params).sched.due).getTime() - now.getTime());
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

/**
 * A deck's settings: its own, else its nearest ancestor's ("A::B::C" falls back to "A::B", then
 * "A"), else none (the defaults). Anki lists every deck under its preset, so the fallback only
 * matters for a deck that wasn't in the export.
 */
export function paramsForDeck(deck: string, all: Map<string, DeckParams>): DeckParams | undefined {
  const parts = deck.split('::');
  for (let i = parts.length; i > 0; i--) {
    const p = all.get(parts.slice(0, i).join('::'));
    if (p) return p;
  }
  return undefined;
}
