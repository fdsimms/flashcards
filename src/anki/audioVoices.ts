import { utf8Decode, utf8Encode } from './protobuf';
import type { SyncDb } from './sync/collectionSync';
import { parseJson, stringifyJson } from './sync/json';
import { COL_MODIFIED_SQL } from './writeback';

/**
 * The Azure voice each language's cards are recorded with, kept in the Anki collection so the MCP records a
 * note it adds the way this phone records one saved here (src/core/recording.ts). The phone's own choice
 * is in Settings, Voices, stored on the phone only, so this is the copy the server can read. One config
 * value, a JSON object from a language code to its voice (`{"th": {"voice": "th-TH-PremwadeeNeural", "rate": 1}}`);
 * the MCP reads and writes the same key (`AUDIO_VOICES_KEY` in server/mcp/franki_mcp/tools.py).
 *
 * The phone writes a language's entry when its Azure voice is chosen or cleared, and no other: a
 * language only the MCP has a voice for keeps it.
 */
export const AUDIO_VOICES_KEY = 'frankiAudioVoices';

export interface AudioVoice {
  /** The Azure voice's name (th-TH-PremwadeeNeural). */
  voice: string;
  /** 1 is normal speed. */
  rate: number;
  /** The text's language and region, only for a Multilingual voice, which the MCP writes. */
  locale?: string;
}

/** The voices in a config value, by language code. Anything that isn't a voice is dropped. */
export function audioVoicesFromConfig(val: Uint8Array | string | null | undefined): Map<string, AudioVoice> {
  const out = new Map<string, AudioVoice>();
  if (val == null) return out;
  let parsed: unknown;
  try { parsed = parseJson(typeof val === 'string' ? val : utf8Decode(val)); } catch { return out; }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return out;
  for (const [lang, v] of Object.entries(parsed)) {
    const o = v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
    if (!o || typeof o.voice !== 'string' || !o.voice) continue;
    out.set(lang, {
      voice: o.voice,
      rate: typeof o.rate === 'number' && o.rate >= 0.5 && o.rate <= 2 ? o.rate : 1,
      ...(typeof o.locale === 'string' && o.locale ? { locale: o.locale } : {}),
    });
  }
  return out;
}

const toConfig = (all: Map<string, AudioVoice>): string =>
  stringifyJson(Object.fromEntries([...all].sort(([a], [b]) => a.localeCompare(b))));

/**
 * Sets a language's voice in the kept collection, or with none removes it. A sync carries it. Only that
 * language's entry changes, and nothing is written when it already says this.
 */
export async function setAnkiAudioVoice(db: SyncDb, language: string, voice: AudioVoice | null, now: Date): Promise<void> {
  const stored = await db.first<{ val: Uint8Array }>('SELECT val FROM config WHERE KEY = ?', AUDIO_VOICES_KEY);
  const all = audioVoicesFromConfig(stored?.val);
  const before = all.get(language);
  if (voice === null ? before === undefined : before?.voice === voice.voice && before.rate === voice.rate && before.locale === voice.locale) return;
  if (voice === null) all.delete(language);
  else all.set(language, voice);
  await db.transaction(async () => {
    await db.run('INSERT OR REPLACE INTO config (KEY, usn, mtime_secs, val) VALUES (?, -1, ?, ?)',
      AUDIO_VOICES_KEY, Math.floor(now.getTime() / 1000), utf8Encode(toConfig(all)));
    await db.run(COL_MODIFIED_SQL, now.getTime());
  });
}
