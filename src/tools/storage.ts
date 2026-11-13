import * as SecureStore from 'expo-secure-store';
import { DEFAULT_TOOL_PREFS, parseToolPrefs, type ToolPrefs } from './prefs';

/**
 * The Practice tools' settings, kept on this phone beside Read & Listen's (src/reader/storage.ts):
 * read once, then held here, so a tool opens with them already in place. A failed save only means
 * the setting resets next launch.
 */

const KEY = 'tools.prefs';

let current: ToolPrefs = DEFAULT_TOOL_PREFS;
let loaded: Promise<void> | undefined;
/** Choices made before the first read finished: they win over what that read finds. */
let early: Partial<ToolPrefs> | undefined = {};

/**
 * The saved prefs, as they are now. The read happens once, but every caller gets `current` when
 * it resolves, not the object that read produced: a tool opened after a choice was made must see
 * that choice, not the prefs as they were at launch.
 */
export function loadToolPrefs(): Promise<ToolPrefs> {
  loaded ??= SecureStore.getItemAsync(KEY)
    .then(parseToolPrefs, () => DEFAULT_TOOL_PREFS)
    .then((p) => {
      current = { ...p, ...early };
      early = undefined;
    });
  return loaded.then(() => current);
}

export const toolPrefs = (): ToolPrefs => current;

export function saveToolPrefs(change: Partial<ToolPrefs>): void {
  if (early) early = { ...early, ...change };
  current = { ...current, ...change };
  SecureStore.setItemAsync(KEY, JSON.stringify(current)).catch(() => undefined);
}
