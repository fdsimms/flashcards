import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { parsePrefs, parseState, type WaniKaniPrefs, type WaniKaniState } from './prefs';

/**
 * WaniKani's token and options in the Keychain, like Read & Listen's passphrase: this phone's own,
 * never in a backup. Answers not yet sent and the production notes already made are in a file in
 * the documents folder (they can grow past what the Keychain is meant for).
 */

const TOKEN_KEY = 'wanikani.token';
const PREFS_KEY = 'wanikani.prefs';
const STATE_FILE = 'wanikani.json';

export const loadToken = () => SecureStore.getItemAsync(TOKEN_KEY);
export const saveToken = (value: string) => SecureStore.setItemAsync(TOKEN_KEY, value);
export const clearToken = () => SecureStore.deleteItemAsync(TOKEN_KEY);

export async function loadPrefs(): Promise<WaniKaniPrefs> {
  try {
    return parsePrefs(await SecureStore.getItemAsync(PREFS_KEY));
  } catch {
    return parsePrefs(null);
  }
}

export function savePrefs(prefs: WaniKaniPrefs): void {
  SecureStore.setItemAsync(PREFS_KEY, JSON.stringify(prefs)).catch(() => undefined);
}

function stateFile(): File {
  return new File(Paths.document, STATE_FILE);
}

export async function loadState(): Promise<WaniKaniState> {
  try {
    const f = stateFile();
    return parseState(f.exists ? await f.text() : null);
  } catch {
    return parseState(null);
  }
}

export function saveState(state: WaniKaniState): void {
  try {
    const f = stateFile();
    if (!f.exists) f.create();
    f.writeSync(JSON.stringify(state));
  } catch {
    // Nothing to do: answers still in memory are tried again while the app is open.
  }
}
