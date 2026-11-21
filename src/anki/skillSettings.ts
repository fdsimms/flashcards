import { deckLineage } from '../core/deckTree';
import { SKILL_GROUP_IDS, type SkillGroup } from '../tools/skills';
import { utf8Decode, utf8Encode } from './protobuf';
import type { SyncDb } from './sync/collectionSync';
import { parseJson, stringifyJson } from './sync/json';
import { COL_MODIFIED_SQL } from './writeback';

/**
 * A deck's skill card settings kept in the Anki collection, so a sync carries them and the MCP's
 * daily job (server/mcp/franki_mcp/skills.py) reads the same ones. One config value, a JSON object
 * from a deck's id to its settings (`{"1794408857989": {"on": true, "auto": true, "off": ["money"]}}`),
 * the way the progress gates are kept (progressGates.ts) and read the same ways. The MCP reads and
 * writes the same key (`SKILL_CARDS_KEY` in skills.py).
 *
 * `on` is the master switch: off, the deck's skill cards are suspended and nothing adds more.
 * `off` lists the skill groups the learner switched off, so a group added in a later version is on
 * until switched off. `auto` lets the server add the cards of the groups that are on; off, only the
 * Add button does. A deck with no entry has the defaults.
 */
export const SKILL_CARDS_KEY = 'frankiSkillCards';

export interface SkillSettings {
  on: boolean;
  auto: boolean;
  off: SkillGroup[];
}

export const DEFAULT_SKILL_SETTINGS: SkillSettings = { on: true, auto: false, off: [] };

const isGroup = (v: unknown): v is SkillGroup => typeof v === 'string' && (SKILL_GROUP_IDS as readonly string[]).includes(v);

/** A deck's settings as saved, with what's missing or isn't one of the three kinds of value taken from the defaults. */
function settingsOf(v: unknown): SkillSettings {
  const o = v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
  return {
    on: typeof o.on === 'boolean' ? o.on : DEFAULT_SKILL_SETTINGS.on,
    auto: typeof o.auto === 'boolean' ? o.auto : DEFAULT_SKILL_SETTINGS.auto,
    off: Array.isArray(o.off) ? [...new Set(o.off.filter(isGroup))].sort() : [],
  };
}

export const sameSkillSettings = (a: SkillSettings, b: SkillSettings): boolean =>
  a.on === b.on && a.auto === b.auto && a.off.length === b.off.length && a.off.every((g, i) => g === b.off[i]);

/**
 * Whether a deck's skill cards are paused: the nearest deck at or above it with settings has the master
 * switch off. A skill card sits in `<deck>::Skills`, and the switch is on the language deck above it.
 */
export function skillsPausedIn(deck: string, settings: ReadonlyMap<string, Pick<SkillSettings, 'on'>>): boolean {
  for (const d of deckLineage(deck).reverse()) {
    const s = settings.get(d);
    if (s) return !s.on;
  }
  return false;
}

/** The settings in a config value, by deck id. */
export function skillSettingsFromConfig(val: Uint8Array | string | null | undefined): Map<number, SkillSettings> {
  const out = new Map<number, SkillSettings>();
  if (val == null) return out;
  let parsed: unknown;
  try { parsed = parseJson(typeof val === 'string' ? val : utf8Decode(val)); } catch { return out; }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return out;
  for (const [id, s] of Object.entries(parsed)) {
    const n = Number(id);
    if (Number.isSafeInteger(n)) out.set(n, settingsOf(s));
  }
  return out;
}

const toConfig = (all: Map<number, SkillSettings>): string =>
  stringifyJson(Object.fromEntries([...all].sort(([a], [b]) => a - b).map(([id, s]) => [String(id), s])));

/** The settings by deck name ("A::B"), for the decks the collection still has. */
export function skillSettingsByName(decks: { id: number; name: string }[], val: Uint8Array | string | null | undefined): Map<string, SkillSettings> {
  const all = skillSettingsFromConfig(val);
  const out = new Map<string, SkillSettings>();
  for (const d of decks) {
    const s = all.get(Number(d.id));
    if (s) out.set(d.name, s);
  }
  return out;
}

/** Saves a deck's settings in the kept collection; the defaults remove its entry. False when Anki has no deck by that name. */
export async function setAnkiSkillSettings(db: SyncDb, deck: string, settings: SkillSettings, now: Date): Promise<boolean> {
  const native = deck.split('::').join('\x1f');
  const row = (await db.all<{ id: number; name: string }>('SELECT id, name FROM decks NOT INDEXED')).find((r) => r.name === native);
  if (!row) return false;
  const id = Number(row.id);
  const stored = await db.first<{ val: Uint8Array }>('SELECT val FROM config WHERE KEY = ?', SKILL_CARDS_KEY);
  const all = skillSettingsFromConfig(stored?.val);
  const next = settingsOf(settings);
  if (sameSkillSettings(next, all.get(id) ?? DEFAULT_SKILL_SETTINGS)) return true;
  if (sameSkillSettings(next, DEFAULT_SKILL_SETTINGS)) all.delete(id);
  else all.set(id, next);
  await db.transaction(async () => {
    await db.run('INSERT OR REPLACE INTO config (KEY, usn, mtime_secs, val) VALUES (?, -1, ?, ?)',
      SKILL_CARDS_KEY, Math.floor(now.getTime() / 1000), utf8Encode(toConfig(all)));
    await db.run(COL_MODIFIED_SQL, now.getTime());
  });
  return true;
}
