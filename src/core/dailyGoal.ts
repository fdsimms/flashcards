import { studyDayKey } from './day';
import { cardHomeDeck, groupByDeck, inProgressCount, isInDeck, type DeckLimits } from './deckTree';
import { currentLimits, forecastSteps, passRate, type ForecastInput } from './forecast';
import { MAX_GATE_CAP } from './progress';
import { studiable } from './queue';
import { skillCardIds } from './skillTag';
import type { Answer } from './stats';
import { paramsForDeck } from './scheduler';
import type { DeckParams, DeckSettings } from './types';

/**
 * A deck's daily goal (Deck options, "Keep to a daily goal"): how many cards a day, reviews and new
 * cards together, the learner wants to study in it. Each study day Franki works out the new card
 * setting that keeps every one of the next `GOAL_DAYS` days at or under the goal, and sets it.
 *
 * The lever is the one the deck already uses: a deck with a progress gate gets its cap, any other
 * deck its own daily new card limit. Reviews are never limited to meet a goal: a goal too low for
 * the reviews already scheduled turns new cards off (`over`), and the reviews still come.
 *
 * Nothing here guesses at the learner's history separately: each candidate value is played forward
 * with the Stats forecast (`forecastSteps`: `treeQueue`, the deck's own FSRS settings, Anki's fuzz
 * and load balancer), with the share of reviews passed taken from the deck's own last 30 days
 * (`passRate`). The search tries values from the least upward, doubling, then halves the gap
 * (`tuneSteps`), on the reading that more new cards never mean fewer cards a day.
 *
 * Only the deck's own cards are played forward, for speed: what's left out is other decks' cards on
 * the same preset for the load balancer, and the room other decks use under a parent's limit when
 * the collection applies all parent limits. Neither changes how many cards the deck itself shows
 * unless a parent's limit is what holds it back.
 */

/** How many study days the goal looks ahead, today first: most of a new card's reviews come in its first month. */
export const GOAL_DAYS = 30;
/** The largest goal (Anki's largest daily limit, `LIMIT_MAX`). */
export const MAX_DAILY_GOAL = 9999;
/** A search never plays more candidates forward than this, so a deck whose load doesn't settle can't run on. */
const MAX_RUNS = 24;

/** What the goal sets: a gated deck's cap, or any other deck's daily new card limit. */
export type GoalLever = 'gate' | 'new';

/** One day's tuning, kept on the phone for Deck options to show (`DeckSettings.goalTuned`). */
export interface GoalResult {
  /** The study day it was worked out on (`studyDayKey`); a new day tunes again. */
  day: string;
  /** The goal it was worked out for, so a changed goal tunes again at once. */
  goal: number;
  lever: GoalLever;
  /** The value set: new cards a day, or the most cards in progress. */
  value: number;
  /** New cards today at that value, as the forecast plays today. */
  newToday: number;
  /** Cards expected each day, reviews and new together, today first. */
  loads: number[];
  /** Even the least the lever allows goes over the goal on some day: new cards are off. */
  over: boolean;
}

/** The goal typed on Deck options, or why it can't be used. Refused inline, never quietly changed into another number. */
export function parseDailyGoal(text: string): { goal: number } | { error: string } {
  const t = text.trim();
  const goal = Number(t);
  if (!/^\d+$/.test(t) || goal < 1 || goal > MAX_DAILY_GOAL) return { error: `Enter a whole number from 1 to ${MAX_DAILY_GOAL}.` };
  return { goal };
}

/** Whether a deck's tuning is still current: worked out today, for the goal it has now. */
export function tunedToday(settings: DeckSettings | undefined, now: Date, dayStartsAtHour: number): boolean {
  const t = settings?.goalTuned;
  return !!t && settings?.dailyGoal === t.goal && t.day === studyDayKey(now, dayStartsAtHour);
}

/** What the forecast needs about the whole collection; the deck's own share is cut from it here. */
export type GoalBase = Pick<ForecastInput, 'notes' | 'cards' | 'params' | 'collection' | 'studied' | 'settings' | 'vacation' | 'held' | 'now'>;

export interface GoalInput extends GoalBase {
  deck: string;
  goal: number;
  /** Every answer on record from at least `PASS_RATE_DAYS` back; only the deck's own set its pass rate. */
  answers: Answer[];
}

/** The most cards a day on any of the days played. */
const peak = (loads: number[]) => loads.reduce((m, v) => Math.max(m, v), 0);

/**
 * The search, a forecast day at a time so a screen can hand the thread back between days (as
 * `forecastSteps` does). The return value is the day's tuning.
 */
export function* tuneSteps(input: GoalInput): Generator<void, GoalResult> {
  const { deck, goal, now } = input;
  const h = input.collection.dayStartsAtHour;
  const notes = input.notes.filter((n) => isInDeck(n.deck, deck));
  const deckOfNote = new Map(notes.map((n) => [n.id, n.deck]));
  const cards = input.cards.filter((c) => {
    const noteDeck = deckOfNote.get(c.noteId);
    return noteDeck !== undefined && isInDeck(cardHomeDeck(c, noteDeck), deck);
  });
  const own = new Set(cards.map((c) => c.id));
  const rate = passRate(input.answers.filter((a) => own.has(a.cardId)), now, h);
  const lever: GoalLever = input.settings.get(deck)?.gateCap !== undefined ? 'gate' : 'new';
  const base: GoalBase = { ...input, notes, cards };

  // The least the lever allows, and past which a larger value can change nothing in the window.
  const limits: DeckLimits = currentLimits(base, deck);
  const inProgress = inProgressCount(deck, groupByDeck(cards, deckOfNote), skillCardIds(notes, cards));
  const unstarted = studiable(cards).filter((c) => c.sched.state === 0).length;
  const lo = lever === 'gate' ? 1 : 0;
  const hi = lever === 'gate'
    ? Math.max(lo, Math.min(MAX_GATE_CAP, inProgress + limits.newPerDay * GOAL_DAYS))
    : Math.min(goal, unstarted);

  const runs = new Map<number, { loads: number[]; newToday: number }>();
  function* run(value: number): Generator<void, { loads: number[]; newToday: number }> {
    const done = runs.get(value);
    if (done) return done;
    const trial: ForecastInput = {
      ...base, roots: [deck], passRate: rate, days: GOAL_DAYS,
      ...(lever === 'gate'
        ? { settings: new Map(input.settings).set(deck, { ...input.settings.get(deck), gateCap: value }) }
        : { limits: new Map([[deck, { newPerDay: value }]]) }),
    };
    const steps = forecastSteps(trial);
    let step = steps.next();
    while (!step.done) { yield; step = steps.next(); }
    const r = { loads: step.value.days.map((d) => d.scheduled + d.expected), newToday: step.value.days[0]?.introduced ?? 0 };
    runs.set(value, r);
    return r;
  }
  const fits = function* (value: number): Generator<void, boolean> {
    return peak((yield* run(value)).loads) <= goal;
  };
  const result = (value: number, r: { loads: number[]; newToday: number }, over: boolean): GoalResult =>
    ({ day: studyDayKey(now, h), goal, lever, value, newToday: r.newToday, loads: r.loads, over });

  if (!(yield* fits(lo))) {
    // Nothing fits. A gate is left at what's in progress now rather than 1, which reads as "no room"
    // on the deck list and lets nothing in today all the same.
    return result(lever === 'gate' ? Math.max(1, Math.min(MAX_GATE_CAP, inProgress)) : 0, yield* run(lo), true);
  }
  let good = lo;
  let bad: number | undefined;
  for (let stride = 1; good < hi && runs.size < MAX_RUNS; stride *= 2) {
    const x = Math.min(hi, good + stride);
    if (yield* fits(x)) good = x;
    else { bad = x; break; }
  }
  while (bad !== undefined && bad - good > 1 && runs.size < MAX_RUNS) {
    const mid = Math.floor((good + bad) / 2);
    if (yield* fits(mid)) good = mid;
    else bad = mid;
  }
  return result(good, yield* run(good), false);
}

/** The whole search at once (tests; a screen runs `tuneSteps` a day at a time). */
export function tune(input: GoalInput): GoalResult {
  const steps = tuneSteps(input);
  for (let step = steps.next(); ; step = steps.next()) if (step.done) return step.value;
}

/**
 * Where a deck's goal sets its lever: `gate`, a gated deck's cap; `anki`, the deck's own daily new
 * limit in the collection (Anki's "This deck"), so the other decks on its preset keep theirs; `own`,
 * Deck options' own limit for a deck with no Anki preset. Undefined when there's nothing a goal can
 * set: a filtered deck, or a deck made in Franki under an Anki deck, which studies with that deck's limits.
 */
export type GoalTarget = 'gate' | 'anki' | 'own';

export function goalTarget(deck: string, settings: DeckSettings | undefined, params: Map<string, DeckParams>): GoalTarget | undefined {
  const own = params.get(deck);
  if (paramsForDeck(deck, params)?.filtered) return undefined;
  if (settings?.gateCap !== undefined) return 'gate';
  if (own) return 'anki';
  return paramsForDeck(deck, params) ? undefined : 'own';
}

/**
 * The deck's own settings with a day's tuning applied: the gate's cap set, or a preset-less deck's
 * own daily new limit; and the result kept for Deck options. An `anki` target takes its limit in the
 * collection instead (`saveDeckNewLimit`, src/anki/presetService.ts).
 */
export function withTuning(settings: DeckSettings, r: GoalResult, target: GoalTarget): DeckSettings {
  if (target === 'gate') return { ...settings, gateCap: r.value, goalTuned: r };
  return target === 'own' ? { ...settings, newPerDay: r.value, goalTuned: r } : { ...settings, goalTuned: r };
}
