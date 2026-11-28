import { MAX_DAILY_GOAL } from '../core/dailyGoal';
import type { DeckSettings } from '../core/types';
import { deckNumbersByName, deckNumbersFromConfig, setAnkiDeckNumber } from './progressGates';
import type { SyncDb } from './sync/collectionSync';

/**
 * Franki's daily goals (`DeckSettings.dailyGoal`, src/core/dailyGoal.ts) kept in the Anki
 * collection, so a sync carries them and every device running Franki tunes a deck to the same
 * goal. One config value, a JSON object from a deck's id to its goal (`{"1794408857989": 120}`),
 * kept and read exactly as the progress gates are (progressGates.ts). Anki keeps the key without
 * knowing it. Only the goal is kept here: each day's tuning is the phone's own (`goalTuned`), and
 * what it sets (a gate's cap, a deck's own new limit) is kept where that setting always is.
 */
export const DAILY_GOALS_KEY = 'frankiDailyGoals';

/**
 * What each deck's goal replaced (`DeckSettings.goalReplaced`), kept beside the goals the same way, so
 * whichever device turns a goal off puts back the value from before it: each device tunes the deck, and
 * one tuning after another only ever sees the value the goal set. A deck's number is that value, or
 * `NO_OWN_VALUE` where the deck had none of its own (no Anki limit of its own; a gate always has a cap).
 */
export const GOAL_REPLACED_KEY = 'frankiGoalReplaced';
export const NO_OWN_VALUE = -1;

const isGoal = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_DAILY_GOAL;

const isReplaced = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= NO_OWN_VALUE;

/** What each deck's goal replaced, by deck name, with `NO_OWN_VALUE` read as null. */
export function goalReplacedByName(decks: { id: number; name: string }[], val: Uint8Array | string | null | undefined): Map<string, number | null> {
  return new Map([...deckNumbersByName(decks, deckNumbersFromConfig(val, isReplaced))].map(([deck, v]) => [deck, v === NO_OWN_VALUE ? null : v]));
}

/** Sets or, with undefined, removes what a deck's goal replaced (null: none of its own). False when Anki has no deck by that name. */
export function setAnkiGoalReplaced(db: SyncDb, deck: string, value: number | null | undefined, now: Date): Promise<boolean> {
  return setAnkiDeckNumber(db, GOAL_REPLACED_KEY, deck, value === null ? NO_OWN_VALUE : value, isReplaced, 'A value a goal replaced is a whole number of 0 or more.', now);
}

/** The goals by deck name ("A::B"), for the decks the collection still has. */
export function dailyGoalsByName(decks: { id: number; name: string }[], val: Uint8Array | string | null | undefined): Map<string, number> {
  return deckNumbersByName(decks, deckNumbersFromConfig(val, isGoal));
}

/**
 * The deck settings with the collection's goals, and what they replaced, applied: a deck Anki has
 * takes both from there, or has neither.
 */
export function withCollectionGoals(local: Map<string, DeckSettings>, goals: Map<string, number>, replaced: Map<string, number | null>, ankiDecks: Set<string>): Map<string, DeckSettings> {
  const settings = new Map(local);
  for (const [deck, s] of local) {
    if (!ankiDecks.has(deck)) continue;
    if (s.dailyGoal !== undefined && !goals.has(deck)) settings.set(deck, { ...settings.get(deck), dailyGoal: undefined });
    // One kept on the phone before it moved here stays while the deck has its goal (the next save moves it);
    // with the goal off, from any device, it has been put back already.
    if (s.goalReplaced !== undefined && !replaced.has(deck) && !goals.has(deck)) settings.set(deck, { ...settings.get(deck), goalReplaced: undefined });
  }
  for (const [deck, goal] of goals) settings.set(deck, { ...settings.get(deck), dailyGoal: goal });
  for (const [deck, value] of replaced) settings.set(deck, { ...settings.get(deck), goalReplaced: value });
  return settings;
}

/** Sets or, with none, removes a deck's goal in the kept collection. False when Anki has no deck by that name. */
export function setAnkiDailyGoal(db: SyncDb, deck: string, goal: number | undefined, now: Date): Promise<boolean> {
  return setAnkiDeckNumber(db, DAILY_GOALS_KEY, deck, goal, isGoal, `Enter a whole number from 1 to ${MAX_DAILY_GOAL}.`, now);
}
