import { utf8Decode, utf8Encode } from './protobuf';
import type { SyncDb } from './sync/collectionSync';
import { parseJson, stringifyJson } from './sync/json';
import { COL_MODIFIED_SQL } from './writeback';

/**
 * Whether a word's Audio is a native speaker's recording from Wikimedia Commons where there is one
 * (docs/read-and-listen/architecture.md, Native recordings), kept in the Anki collection so the MCP
 * decides the same when it adds a note. One config value, `{"on": true, "languages": {"th": true}}`; the
 * MCP reads the same key (`NATIVE_KEY` in server/mcp/franki_mcp/native.py). Off until turned on in
 * Settings, Voices.
 */
export const NATIVE_RECORDINGS_KEY = 'frankiNativeRecordings';

/** Languages Commons has too few of the common words of to be worth trying unless asked (native.py's `OFF_BY_DEFAULT`). */
export const NATIVE_OFF_BY_DEFAULT: readonly string[] = ['th', 'el'];

export interface NativeRecordingsConfig {
  on: boolean;
  /** A language's own choice; one not listed follows `NATIVE_OFF_BY_DEFAULT`. */
  languages: Record<string, boolean>;
}

export const NATIVE_OFF: NativeRecordingsConfig = { on: false, languages: {} };

export function nativeConfigFromValue(val: Uint8Array | string | null | undefined): NativeRecordingsConfig {
  if (val == null) return NATIVE_OFF;
  let parsed: unknown;
  try { parsed = parseJson(typeof val === 'string' ? val : utf8Decode(val)); } catch { return NATIVE_OFF; }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return NATIVE_OFF;
  const o = parsed as Record<string, unknown>;
  const languages: Record<string, boolean> = {};
  if (o.languages && typeof o.languages === 'object' && !Array.isArray(o.languages)) {
    for (const [k, v] of Object.entries(o.languages)) if (typeof v === 'boolean') languages[k] = v;
  }
  return { on: o.on === true, languages };
}

/** Whether native recordings are used for `language` (a code): the switch, then the language's own choice. */
export function nativeWanted(config: NativeRecordingsConfig, language: string): boolean {
  if (!config.on) return false;
  const choice = config.languages[language];
  return choice ?? !NATIVE_OFF_BY_DEFAULT.includes(language);
}

const toConfig = (c: NativeRecordingsConfig): string =>
  stringifyJson({ on: c.on, languages: Object.fromEntries(Object.entries(c.languages).sort(([a], [b]) => a.localeCompare(b))) });

/** Saves the setting in the kept collection, where a sync carries it. Nothing is written when it already says this. */
export async function setAnkiNativeRecordings(db: SyncDb, config: NativeRecordingsConfig, now: Date): Promise<void> {
  const stored = await db.first<{ val: Uint8Array }>('SELECT val FROM config WHERE KEY = ?', NATIVE_RECORDINGS_KEY);
  if (stored && toConfig(nativeConfigFromValue(stored.val)) === toConfig(config)) return;
  await db.transaction(async () => {
    await db.run('INSERT OR REPLACE INTO config (KEY, usn, mtime_secs, val) VALUES (?, -1, ?, ?)',
      NATIVE_RECORDINGS_KEY, Math.floor(now.getTime() / 1000), utf8Encode(toConfig(config)));
    await db.run(COL_MODIFIED_SQL, now.getTime());
  });
}
