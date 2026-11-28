import * as SecureStore from 'expo-secure-store';
import type { Language } from '../reader/api';
import { DEFAULT_PLAN_PREFS, EMPTY_PLAN_STATE, parsePlanPrefs, parsePlanState, recordPlanDone, type PlanPrefs, type PlanState } from './plan';

/**
 * Today's plan's settings and its days (plan.ts), kept on this phone in the Keychain like Daily
 * extras' (extrasStorage.ts): read once, held here, and every change reaches the screens listening.
 * A failed save only means a day's dot or a done item is forgotten after a relaunch.
 */

const PREFS_KEY = 'plan.prefs';
const STATE_KEY = 'plan.state';

let prefs: PlanPrefs = DEFAULT_PLAN_PREFS;
let state: PlanState = EMPTY_PLAN_STATE;
let loaded: Promise<void> | undefined;
const listeners = new Set<() => void>();

export interface Plan { prefs: PlanPrefs; state: PlanState }

export function loadPlan(): Promise<Plan> {
  loaded ??= Promise.all([SecureStore.getItemAsync(PREFS_KEY).catch(() => null), SecureStore.getItemAsync(STATE_KEY).catch(() => null)])
    .then(([p, s]) => { prefs = parsePlanPrefs(p); state = parsePlanState(s); });
  return loaded.then(() => ({ prefs, state }));
}

export function subscribePlan(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const notify = () => { for (const l of listeners) l(); };

/** Saves the settings, throwing when the Keychain won't take them. */
export async function savePlanPrefs(next: PlanPrefs): Promise<void> {
  await loadPlan();
  await SecureStore.setItemAsync(PREFS_KEY, JSON.stringify(next));
  prefs = next;
  notify();
}

let queue: Promise<void> = Promise.resolve();

/** Changes the plan's state, one change at a time: `change` gets the state as it is when its turn comes. */
export function updatePlanState(change: (s: PlanState) => PlanState): Promise<void> {
  queue = queue.then(async () => {
    await loadPlan();
    const next = change(state);
    if (next === state) return;
    state = next;
    notify();
    await SecureStore.setItemAsync(STATE_KEY, JSON.stringify(state));
  }).catch(() => undefined);
  return queue;
}

/** A lesson heard to its end, a Situations scene finished, or a journal entry checked, in `language`. */
export function recordPlanItem(kind: 'listen' | 'speak' | 'write', language: Language): void {
  updatePlanState((s) => recordPlanDone(s, kind, language, Date.now()));
}
