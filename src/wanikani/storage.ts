import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { parseFuriganaData, type FuriganaData } from './furigana';
import { parseKanjiLevels, type KanjiLevels } from './kanjiLevels';
import { parseSnapshot, type Snapshot } from './offline';
import { parseStats, type WaniKaniStats } from './stats';
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

const OFFLINE_FILE = 'wanikani-offline.json';
const AUDIO_FOLDER = 'wanikani-audio';
const FURIGANA_FILE = 'wanikani-furigana.json';
const KANJI_LEVELS_FILE = 'wanikani-kanji-levels.json';

/** The offline copy (offline.ts), in the documents folder: a few megabytes, too big for the Keychain. */
export async function loadSnapshot(): Promise<Snapshot | null> {
  try {
    const f = new File(Paths.document, OFFLINE_FILE);
    return parseSnapshot(f.exists ? await f.text() : null);
  } catch {
    return null;
  }
}

export async function saveSnapshot(snapshot: Snapshot): Promise<void> {
  const f = new File(Paths.document, OFFLINE_FILE);
  if (!f.exists) f.create();
  await f.write(JSON.stringify(snapshot));
}

const STATS_FILE = 'wanikani-stats.json';

/** The stage counts, level progress and forecast as last read (stats.ts), so the row and its screen have them offline. */
export async function loadStats(): Promise<WaniKaniStats | null> {
  try {
    const f = new File(Paths.document, STATS_FILE);
    return parseStats(f.exists ? await f.text() : null);
  } catch {
    return null;
  }
}

export function saveStats(stats: WaniKaniStats): void {
  try {
    const f = new File(Paths.document, STATS_FILE);
    if (!f.exists) f.create();
    f.writeSync(JSON.stringify(stats));
  } catch {
    // Nothing to do: the next read writes it again.
  }
}

function audioFolder(): Directory {
  const dir = new Directory(Paths.document, AUDIO_FOLDER);
  dir.create({ idempotent: true, intermediates: true });
  return dir;
}

/** A kept recording's address on this phone, or undefined when it isn't kept. */
export function localAudioUri(name: string): string | undefined {
  try {
    const f = new File(audioFolder(), name);
    return f.exists ? f.uri : undefined;
  } catch {
    return undefined;
  }
}

/** Downloads the recordings not kept yet, a few at a time, and deletes the ones no longer wanted. A failed one is tried at the next copy. */
export async function keepAudio(wanted: Map<string, string>, download: (url: string) => Promise<Uint8Array>): Promise<void> {
  const dir = audioFolder();
  for (const e of dir.list()) {
    if (e instanceof File && !wanted.has(e.name)) e.delete();
  }
  const todo = [...wanted].filter(([name]) => !new File(dir, name).exists);
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const [name, url] = todo[next++];
      try {
        const bytes = await download(url);
        const f = new File(dir, name);
        f.create({ overwrite: true });
        await f.write(bytes);
      } catch {
        // Offline again, or the file is gone: left for the next copy.
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
}

/** Signing out: the copy and its recordings go too. */
export function clearOffline(): void {
  try {
    const f = new File(Paths.document, OFFLINE_FILE);
    if (f.exists) f.delete();
    const stats = new File(Paths.document, STATS_FILE);
    if (stats.exists) stats.delete();
    // What furigana knows from WaniKani (furigana.ts) goes with the token too.
    const furigana = new File(Paths.document, FURIGANA_FILE);
    if (furigana.exists) furigana.delete();
    const levels = new File(Paths.document, KANJI_LEVELS_FILE);
    if (levels.exists) levels.delete();
    const dir = new Directory(Paths.document, AUDIO_FOLDER);
    if (dir.exists) dir.delete();
  } catch {
    // Nothing to do: the next sign-in overwrites them.
  }
}


/** What furigana needs from WaniKani (furigana.ts), in the documents folder: every kanji's readings is too big for the Keychain. */
export async function loadFuriganaData(): Promise<FuriganaData | null> {
  try {
    const f = new File(Paths.document, FURIGANA_FILE);
    return parseFuriganaData(f.exists ? await f.text() : null);
  } catch {
    return null;
  }
}

export function saveFuriganaData(data: FuriganaData): void {
  try {
    const f = new File(Paths.document, FURIGANA_FILE);
    if (!f.exists) f.create();
    f.writeSync(JSON.stringify(data));
  } catch {
    // Nothing to do: it's read from WaniKani again next time.
  }
}

/** Each kanji's WaniKani level (kanjiLevels.ts), in the documents folder. */
export async function loadKanjiLevels(): Promise<KanjiLevels | null> {
  try {
    const f = new File(Paths.document, KANJI_LEVELS_FILE);
    return parseKanjiLevels(f.exists ? await f.text() : null);
  } catch {
    return null;
  }
}

export function saveKanjiLevels(data: KanjiLevels): void {
  try {
    const f = new File(Paths.document, KANJI_LEVELS_FILE);
    if (!f.exists) f.create();
    f.writeSync(JSON.stringify(data));
  } catch {
    // Nothing to do: it's read from WaniKani again next time.
  }
}
