import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import type { Settings } from './api';
import { parseSeasonChoices } from './stories';
import { decodeGrammarDue, encodeGrammarDue, type GrammarDue } from './grammarDueCopy';
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
const SEASONS_KEY = 'reader.seasons.';

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

/** Which of a story's seasons the reader opened or closed on its page (stories.ts, seasonOpen). */
export async function loadSeasonChoices(storyId: number): Promise<Record<number, boolean>> {
  try {
    return parseSeasonChoices(await SecureStore.getItemAsync(SEASONS_KEY + storyId));
  } catch {
    return {};
  }
}

export function saveSeasonChoices(storyId: number, chosen: Record<number, boolean>): void {
  SecureStore.setItemAsync(SEASONS_KEY + storyId, JSON.stringify(chosen)).catch(() => undefined);
}

const SETTINGS_FILE = 'reader-settings.json';

/**
 * The server's settings for Read & Listen (each language's deck, voices) as last read, kept in the
 * documents folder for the server at `address`, so a launch with no connection still knows each
 * language's deck: Today's extras and Review's glosses read it. The server's copy is the record;
 * this is replaced each time it's read.
 */
export async function loadSettingsCopy(address: string): Promise<Settings | null> {
  try {
    const f = new File(Paths.document, SETTINGS_FILE);
    const o = f.exists ? JSON.parse(await f.text()) : null;
    return o?.address === address && o.settings && typeof o.settings === 'object' ? (o.settings as Settings) : null;
  } catch {
    return null;
  }
}

export function saveSettingsCopy(address: string, settings: Settings): void {
  try {
    const f = new File(Paths.document, SETTINGS_FILE);
    if (!f.exists) f.create();
    f.writeSync(JSON.stringify({ address, settings }));
  } catch {
    // Read from the server again next launch.
  }
}

const GRAMMAR_DUE_FILE = 'reader-grammar-due.json';

/** The grammar-due copy (grammarDueCopy.ts) for study day `day`, or null when there's none for it. */
export async function loadGrammarDueCopy(day: string): Promise<GrammarDue | null> {
  try {
    const f = new File(Paths.document, GRAMMAR_DUE_FILE);
    return f.exists ? decodeGrammarDue(await f.text(), day) : null;
  } catch {
    return null;
  }
}

export function saveGrammarDueCopy(due: GrammarDue, day: string): void {
  try {
    const f = new File(Paths.document, GRAMMAR_DUE_FILE);
    if (!f.exists) f.create();
    f.writeSync(encodeGrammarDue(due, day));
  } catch {
    // Today shows the chips once the server answers.
  }
}
