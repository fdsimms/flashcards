import { MAX_GATE_CAP } from '../core/progress';
import type { DeckSettings } from '../core/types';
import { utf8Decode, utf8Encode } from './protobuf';
import type { SyncDb } from './sync/collectionSync';
import { parseJson, stringifyJson } from './sync/json';
import { COL_MODIFIED_SQL } from './writeback';

/**
 * Franki's progress gates (`DeckSettings.gateCap`) kept in the Anki collection, so a sync carries
 * them and the MCP can set them. One config value, a JSON object from a deck's id to its cap
 * (`{"1794408857989": 40}`): Anki keeps a config key it doesn't know and syncs it, as it does the
 * MCP's `frankiTier` preset mark. Keyed by id so renaming a deck keeps its gate; an id whose deck
 * is gone is ignored. The MCP reads and writes the same key (`PROGRESS_GATES_KEY` in
 * server/mcp/franki_mcp/tools.py).
 *
 * Reads on the phone go through the attached collection (`keptSql().gates`, no lock), writes through
 * the sync connection under `lockAnki`, like the collapsed state (deckWrites.ts). A write is a
 * config row with usn -1 and the collection's modified stamp, without which a sync never sends it.
 */
export const PROGRESS_GATES_KEY = 'frankiProgressGates';

const isCap = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_GATE_CAP;

/**
 * A config value that maps deck ids to a whole number (the gates here, the daily goals in
 * dailyGoals.ts), by deck id; an entry `valid` refuses is dropped.
 */
export function deckNumbersFromConfig(val: Uint8Array | string | null | undefined, valid: (v: unknown) => v is number): Map<number, number> {
  const out = new Map<number, number>();
  if (val == null) return out;
  let parsed: unknown;
  try { parsed = parseJson(typeof val === 'string' ? val : utf8Decode(val)); } catch { return out; }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return out;
  for (const [id, v] of Object.entries(parsed)) {
    const n = Number(id);
    if (Number.isSafeInteger(n) && valid(v)) out.set(n, v);
  }
  return out;
}

const deckNumbersToConfig = (all: Map<number, number>): string =>
  stringifyJson(Object.fromEntries([...all].sort(([a], [b]) => a - b).map(([id, v]) => [String(id), v])));

/** Such a value by deck name ("A::B"), for the decks the collection still has. */
export function deckNumbersByName(decks: { id: number; name: string }[], all: Map<number, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of decks) {
    const v = all.get(Number(d.id));
    if (v !== undefined) out.set(d.name, v);
  }
  return out;
}

/**
 * Sets or, with none, removes one deck's number in such a config value in the kept collection. False
 * when Anki has no deck by that name. A write is a config row with usn -1 and the collection's
 * modified stamp, without which a sync never sends it.
 */
export async function setAnkiDeckNumber(db: SyncDb, key: string, deck: string, value: number | undefined, valid: (v: unknown) => v is number, refusal: string, now: Date): Promise<boolean> {
  if (value !== undefined && !valid(value)) throw new RangeError(refusal);
  const native = deck.split('::').join('\x1f');
  const row = (await db.all<{ id: number; name: string }>('SELECT id, name FROM decks NOT INDEXED')).find((r) => r.name === native);
  if (!row) return false;
  const id = Number(row.id);
  const stored = await db.first<{ val: Uint8Array }>('SELECT val FROM config WHERE KEY = ?', key);
  const all = deckNumbersFromConfig(stored?.val, valid);
  if (all.get(id) === value) return true;
  if (value === undefined) all.delete(id);
  else all.set(id, value);
  await db.transaction(async () => {
    await db.run('INSERT OR REPLACE INTO config (KEY, usn, mtime_secs, val) VALUES (?, -1, ?, ?)',
      key, Math.floor(now.getTime() / 1000), utf8Encode(deckNumbersToConfig(all)));
    await db.run(COL_MODIFIED_SQL, now.getTime());
  });
  return true;
}

/** The gates in a config value, by deck id; an entry that isn't a whole cap in range is dropped. */
export function gatesFromConfig(val: Uint8Array | string | null | undefined): Map<number, number> {
  return deckNumbersFromConfig(val, isCap);
}

/** The gates by deck name ("A::B"), for the decks the collection still has. */
export function gatesByName(decks: { id: number; name: string }[], val: Uint8Array | string | null | undefined): Map<string, number> {
  return deckNumbersByName(decks, gatesFromConfig(val));
}

/**
 * The deck settings with the collection's gates applied. A deck Anki has takes its gate from the
 * collection; one with none there keeps a gate saved on the phone before gates moved (`unmoved`
 * lists those, for `moveLocalGates`). A deck Anki doesn't have keeps the phone's.
 */
export function withCollectionGates(
  local: Map<string, DeckSettings>, gates: Map<string, number>, ankiDecks: Set<string>,
): { settings: Map<string, DeckSettings>; unmoved: Map<string, number> } {
  const settings = new Map(local);
  const unmoved = new Map<string, number>();
  for (const [deck, cap] of gates) settings.set(deck, { ...settings.get(deck), gateCap: cap });
  for (const [deck, s] of local) {
    if (s.gateCap !== undefined && ankiDecks.has(deck) && !gates.has(deck)) unmoved.set(deck, s.gateCap);
  }
  return { settings, unmoved };
}

/** Sets or, with no cap, removes a deck's gate in the kept collection. False when Anki has no deck by that name. */
export function setAnkiProgressGate(db: SyncDb, deck: string, cap: number | undefined, now: Date): Promise<boolean> {
  return setAnkiDeckNumber(db, PROGRESS_GATES_KEY, deck, cap, isCap, `Enter a whole number from 1 to ${MAX_GATE_CAP}.`, now);
}
