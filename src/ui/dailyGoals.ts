import { useEffect } from 'react';
import { deckNewLimitOf, saveDeckNewLimit } from '../anki/presetService';
import { addCalendarDays, studyDayStart } from '../core/day';
import { goalTarget, goalTurnedOff, leverValue, tunedToday, tuneSteps, withTuning, type GoalResult } from '../core/dailyGoal';
import type { DeckRow } from '../core/deckTree';
import { PASS_RATE_DAYS } from '../core/forecast';
import { answersFrom } from '../core/stats';
import { reviewWrites } from '../core/writeQueue';
import type { AnkiLink } from '../db/ankiLink';
import type { Repo } from '../db/repo';
import { loadForecastBase } from './useForecast';

/**
 * The daily goal's phone side (src/core/dailyGoal.ts has the rules): once each study day, each deck
 * with a goal is tuned, and what the tuning chose is set (a gate's cap, or the deck's own daily new
 * limit) and kept for Deck options to show. AppContext calls `useDailyGoals` in one line; Deck
 * options calls `tuneDeck` when the goal is changed, so the new value shows at once.
 *
 * Tuning plays a month forward several times, so it runs a forecast day at a time, handing the
 * thread back between days, and one deck at a time.
 */

/** One tuning at a time: each reads the collection after the one before has written its value. */
let running: Promise<unknown> = Promise.resolve();

/** Hands the thread back, so the screen keeps scrolling while the forecast runs. */
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Tunes a deck to its goal and sets what the tuning chose. Undefined when the deck has no goal, or
 * nothing a goal can set (`goalTarget`), or its goal changed while it ran (the next run has it).
 */
export function tuneDeck(repo: Repo & AnkiLink, deck: string): Promise<GoalResult | undefined> {
  const run = running.then(() => tuneOnce(repo, deck), () => tuneOnce(repo, deck));
  running = run.catch(() => undefined);
  return run;
}

async function tuneOnce(repo: Repo & AnkiLink, deck: string): Promise<GoalResult | undefined> {
  await reviewWrites.idle();
  const now = new Date();
  const [settings, params, collection] = await Promise.all([repo.listDeckSettings(), repo.listDeckParams(), repo.collectionSettings()]);
  const goal = settings.get(deck)?.dailyGoal;
  if (goal === undefined || !goalTarget(deck, settings.get(deck), params)) return undefined;
  const [notes, cards] = await Promise.all([repo.listNotes(), repo.listCards()]);
  const base = await loadForecastBase(repo, { notes, cards, params, now });
  const since = addCalendarDays(studyDayStart(now, collection.dayStartsAtHour), -PASS_RATE_DAYS);
  const [reviews, revlog] = await Promise.all([repo.listReviews(since), repo.ankiReviewLog(since)]);
  const steps = tuneSteps({ ...base, deck, goal, answers: answersFrom({ revlog, reviews, cards }) });
  let step = steps.next();
  while (!step.done) { await breathe(); step = steps.next(); }
  return applyTuning(repo, deck, step.value);
}

/**
 * Sets what a tuning chose, read against the deck's settings as they are now: a goal changed or
 * turned off while it ran (on Deck options, or by a sync) is left for the next run, rather than
 * set to a value worked out for another goal.
 */
async function applyTuning(repo: Repo & AnkiLink, deck: string, r: GoalResult): Promise<GoalResult | undefined> {
  const [all, params] = await Promise.all([repo.listDeckSettings(), repo.listDeckParams()]);
  const settings = all.get(deck) ?? {};
  const target = goalTarget(deck, settings, params);
  if (settings.dailyGoal !== r.goal || !target || (target === 'gate') !== (r.lever === 'gate')) return undefined;
  // What's there before the first tuning is kept, to put back when the goal is turned off (`goalTurnedOff`).
  const replaced = target === 'anki' ? (settings.goalReplaced?.target === 'anki' ? null : await deckNewLimitOf(repo, deck)) : leverValue(settings, target);
  if (target === 'anki') await saveDeckNewLimit(repo, deck, r.value);
  await repo.saveDeckSettings(deck, withTuning(settings, r, target, replaced));
  return r;
}

/**
 * Turns a deck's goal off and puts back what its tuning replaced (`goalTurnedOff`): in the queue with
 * the tunings, so one still running can't set its value after, and read against the settings as they
 * are now.
 */
export function turnGoalOff(repo: Repo & AnkiLink, deck: string): Promise<void> {
  const run = running.then(() => turnOffOnce(repo, deck), () => turnOffOnce(repo, deck));
  running = run.catch(() => undefined);
  return run;
}

async function turnOffOnce(repo: Repo & AnkiLink, deck: string): Promise<void> {
  const [all, params] = await Promise.all([repo.listDeckSettings(), repo.listDeckParams()]);
  const settings = all.get(deck) ?? {};
  const { settings: off, ankiLimit } = goalTurnedOff(settings, goalTarget(deck, settings, params));
  if (ankiLimit !== undefined) await saveDeckNewLimit(repo, deck, ankiLimit);
  await repo.saveDeckSettings(deck, off);
}

/**
 * Tunes every deck whose goal hasn't been tuned this study day (or has changed since), whenever the
 * deck list is counted again (launch, a sync, coming back on a new day), then counts the decks
 * again with what it set. A failure is left for the next count, and Deck options shows the last
 * tuning that worked.
 */
export function useDailyGoals(repo: (Repo & AnkiLink) | null, decks: DeckRow[], refresh: () => Promise<void>): void {
  useEffect(() => {
    if (!repo) return;
    let live = true;
    (async () => {
      const [settings, collection] = await Promise.all([repo.listDeckSettings(), repo.collectionSettings()]);
      const now = new Date();
      const due = [...settings].filter(([, s]) => s.dailyGoal !== undefined && !tunedToday(s, now, collection.dayStartsAtHour)).map(([d]) => d);
      let changed = false;
      for (const deck of due) {
        if (!live) return;
        if (await tuneDeck(repo, deck).catch(() => undefined)) changed = true;
      }
      if (changed && live) await refresh();
    })().catch(() => undefined);
    return () => { live = false; };
  }, [repo, decks]); // eslint-disable-line react-hooks/exhaustive-deps
}
