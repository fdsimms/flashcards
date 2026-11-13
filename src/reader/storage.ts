import * as SecureStore from 'expo-secure-store';
import { parseSeen } from './vocabCheck';
import { DEFAULT_PREFS, parsePrefs, type Prefs } from './prefs';

/**
 * Read & Listen's passphrase, the reader's own settings (speed, highlight) and how many marked
 * words were added to the deck today, kept in the Keychain. The passphrase is never stored anywhere else; the settings sit beside it so they're
 * read before the reader opens. Both are this phone's own, like the sync key.
 */

const PASSPHRASE_KEY = 'reader.passphrase';
const PREFS_KEY = 'reader.prefs';
const VOCAB_SEEN_KEY = 'reader.vocabSeen.';

export const loadPassphrase = () => SecureStore.getItemAsync(PASSPHRASE_KEY);
export const savePassphrase = (value: string) => SecureStore.setItemAsync(PASSPHRASE_KEY, value);
export const clearPassphrase = () => SecureStore.deleteItemAsync(PASSPHRASE_KEY);

let current: Prefs = DEFAULT_PREFS;

/** Loaded once when Read & Listen opens; a failed save only means the setting resets next launch. */
export async function loadPrefs(): Promise<void> {
  try {
    current = parsePrefs(await SecureStore.getItemAsync(PREFS_KEY));
  } catch {
    current = DEFAULT_PREFS;
  }
}

export const prefs = (): Prefs => current;

export function savePrefs(change: Partial<Prefs>): void {
  current = { ...current, ...change };
  SecureStore.setItemAsync(PREFS_KEY, JSON.stringify(current)).catch(() => undefined);
}

/** The words a language's vocabulary check has already asked (vocabCheck.ts), so a retake prefers new ones. */
export async function loadVocabSeen(language: string): Promise<string[]> {
  try {
    return parseSeen(await SecureStore.getItemAsync(VOCAB_SEEN_KEY + language));
  } catch {
    return [];
  }
}

export function saveVocabSeen(language: string, words: string[]): void {
  SecureStore.setItemAsync(VOCAB_SEEN_KEY + language, JSON.stringify(words)).catch(() => undefined);
}
