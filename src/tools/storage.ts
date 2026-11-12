import * as SecureStore from 'expo-secure-store';
import { DEFAULT_TOOL_PREFS, parseToolPrefs, type ToolPrefs } from './prefs';

/**
 * The Practice tools' settings, kept on this phone beside Read & Listen's (src/reader/storage.ts):
 * read once, then held here, so a tool opens with them already in place. A failed save only means
 * the setting resets next launch.
 */

const KEY = 'tools.prefs';

let current: ToolPrefs = DEFAULT_TOOL_PREFS;
let loaded: Promise<ToolPrefs> | undefined;

export function loadToolPrefs(): Promise<ToolPrefs> {
  loaded ??= SecureStore.getItemAsync(KEY).then(parseToolPrefs, () => DEFAULT_TOOL_PREFS).then((p) => (current = p));
  return loaded;
}

export const toolPrefs = (): ToolPrefs => current;

export function saveToolPrefs(change: Partial<ToolPrefs>): void {
  current = { ...current, ...change };
  SecureStore.setItemAsync(KEY, JSON.stringify(current)).catch(() => undefined);
}
