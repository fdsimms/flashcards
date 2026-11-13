import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { parseSnapshot, type Snapshot } from './offline';
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
    const dir = new Directory(Paths.document, AUDIO_FOLDER);
    if (dir.exists) dir.delete();
  } catch {
    // Nothing to do: the next sign-in overwrites them.
  }
}
