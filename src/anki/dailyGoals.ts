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

const isGoal = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_DAILY_GOAL;

/** The goals by deck name ("A::B"), for the decks the collection still has. */
export function dailyGoalsByName(decks: { id: number; name: string }[], val: Uint8Array | string | null | undefined): Map<string, number> {
  return deckNumbersByName(decks, deckNumbersFromConfig(val, isGoal));
}

/** The deck settings with the collection's goals applied: a deck Anki has takes its goal from there, or has none. */
export function withCollectionGoals(local: Map<string, DeckSettings>, goals: Map<string, number>, ankiDecks: Set<string>): Map<string, DeckSettings> {
  const settings = new Map(local);
  for (const [deck, s] of local) if (ankiDecks.has(deck) && s.dailyGoal !== undefined && !goals.has(deck)) settings.set(deck, { ...s, dailyGoal: undefined });
  for (const [deck, goal] of goals) settings.set(deck, { ...settings.get(deck), dailyGoal: goal });
  return settings;
}

/** Sets or, with none, removes a deck's goal in the kept collection. False when Anki has no deck by that name. */
export function setAnkiDailyGoal(db: SyncDb, deck: string, goal: number | undefined, now: Date): Promise<boolean> {
  return setAnkiDeckNumber(db, DAILY_GOALS_KEY, deck, goal, isGoal, `Enter a whole number from 1 to ${MAX_DAILY_GOAL}.`, now);
}
