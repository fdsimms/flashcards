import * as SecureStore from 'expo-secure-store';
import type { Language } from '../reader/api';
import {
  DEFAULT_EXTRA_PREFS, EMPTY_EXTRA_STATE, parseExtraPrefs, parseExtraState, recordAnswer, recordRead, type ExtraPrefs, type ExtraState,
} from './extras';
import type { ToolId } from './tools';

/**
 * Daily extras' settings and what's been done today (extras.ts), kept on this phone in the Keychain
 * like the other settings that are its own: read once, then held here, and every change reaches
 * the screens listening (`subscribeExtras`). A failed save of what's been done only means an
 * extra shows as not done again after a relaunch.
 */

const PREFS_KEY = 'extras.prefs';
const STATE_KEY = 'extras.state';

let prefs: ExtraPrefs = DEFAULT_EXTRA_PREFS;
let state: ExtraState = EMPTY_EXTRA_STATE;
let loaded: Promise<void> | undefined;
const listeners = new Set<() => void>();

export interface Extras { prefs: ExtraPrefs; state: ExtraState }

/** What's saved, as it is now. The read happens once. */
export function loadExtras(): Promise<Extras> {
  loaded ??= Promise.all([SecureStore.getItemAsync(PREFS_KEY).catch(() => null), SecureStore.getItemAsync(STATE_KEY).catch(() => null)])
    .then(([p, s]) => { prefs = parseExtraPrefs(p); state = parseExtraState(s); });
  return loaded.then(() => ({ prefs, state }));
}

/** Calls `listener` after every change; returns the way to stop. */
export function subscribeExtras(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const notify = () => { for (const l of listeners) l(); };

/** Saves the settings, throwing when the Keychain won't take them. */
export async function saveExtraPrefs(next: ExtraPrefs): Promise<void> {
  await loadExtras();
  await SecureStore.setItemAsync(PREFS_KEY, JSON.stringify(next));
  prefs = next;
  notify();
}

// One change at a time, so an answer and the day's plan saved together don't overwrite each other.
let queue: Promise<void> = Promise.resolve();

/** Changes what's been done: `change` gets the state as it is when its turn comes. */
export function updateExtraState(change: (s: ExtraState) => ExtraState): Promise<void> {
  queue = queue.then(async () => {
    await loadExtras();
    state = change(state);
    notify();
    await SecureStore.setItemAsync(STATE_KEY, JSON.stringify(state));
  }).catch(() => undefined);
  return queue;
}

/** A Practice drill's answer, recorded as it's marked (src/ui/tools/useMarks.ts). */
export function recordExtraAnswer(tool: ToolId, language: Language): void {
  updateExtraState((s) => recordAnswer(s, tool, language, Date.now()));
}

/** A text in `language` read to its end (src/ui/Reader.tsx). */
export function recordExtraRead(language: Language): void {
  updateExtraState((s) => recordRead(s, language, Date.now()));
}
