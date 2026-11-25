import type { PresetOptions } from '../core/presetOptions';
import { DECK_CONFIG_FIELDS as F, deckName, readDeckConfig, readDeckKind } from './collection';
import { floatField, packedFloatsField, uint, withField, withFields, withUint, decodeMessage, type Field } from './protobuf';
import type { SyncDb } from './sync/collectionSync';
import { COL_MODIFIED_SQL } from './writeback';

/**
 * A change to a deck options preset, written into the kept Anki collection the way Anki writes
 * one (rslib's deckconfig update): the row's `config` edited in place so every setting Franki
 * doesn't read survives, `mtime_secs` set, `usn` -1 so the next sync sends it
 * (`deckConfigJson`), and the collection stamped modified. Runs on a connection of its own to
 * the kept collection (`withSyncConnection`), inside `lockAnki`.
 */

async function writeConfig(db: SyncDb, presetId: number, config: Uint8Array, now: Date) {
  await db.transaction(async () => {
    await db.run('UPDATE deck_config SET config = ?, mtime_secs = ?, usn = -1 WHERE id = ?', config, Math.floor(now.getTime() / 1000), presetId);
    await db.run(COL_MODIFIED_SQL, now.getTime());
  });
}

/**
 * Sets a preset's "New/review order" (0 mix with reviews, 1 after reviews, 2 before reviews).
 * False when Anki has no such preset.
 */
export async function setAnkiNewMix(db: SyncDb, presetId: number, newMix: number, now: Date): Promise<boolean> {
  const row = await db.first<{ config: Uint8Array }>('SELECT config FROM deck_config WHERE id = ?', presetId);
  if (!row) return false;
  if ((uint(decodeMessage(row.config), F.newMix) ?? 0) === newMix) return true;
  await writeConfig(db, presetId, withUint(row.config, F.newMix, newMix), now);
  return true;
}

/** Deck.KindContainer.normal, and Deck.Normal's own daily new card limit (proto/anki/decks.proto: `optional uint32 new_limit = 7`). */
const KIND_NORMAL = 1;
const NORMAL_NEW_LIMIT = 7;

/**
 * Sets a deck's own daily new card limit (Anki's deck options, "This deck"), which wins over its
 * preset's, as the daily goal does (src/core/dailyGoal.ts) so the other decks on the preset keep
 * theirs. The deck's bytes are edited in place, so everything else in it survives; the field is
 * optional, so 0 is written as 0 (no new cards), not left out. False when Anki has no such normal deck.
 */
export async function setAnkiDeckNewLimit(db: SyncDb, deck: string, limit: number, now: Date): Promise<boolean> {
  const native = deck.split('::').join('\x1f');
  const row = (await db.all<{ id: number; name: string; kind: Uint8Array }>('SELECT id, name, kind FROM decks NOT INDEXED')).find((r) => r.name === native);
  const normal = row ? decodeMessage(row.kind).get(KIND_NORMAL)?.[0] : undefined;
  if (!row || normal?.wire !== 2) return false;
  if (readDeckKind(row.kind)?.newLimit === limit) return true;
  const bytes = withFields(normal.value, { [NORMAL_NEW_LIMIT]: [{ wire: 0, value: BigInt(limit) }] });
  const kind = withField(row.kind, KIND_NORMAL, bytes);
  await db.transaction(async () => {
    await db.run('UPDATE decks SET kind = ?, mtime_secs = ?, usn = -1 WHERE id = ?', kind, Math.floor(now.getTime() / 1000), row.id);
    await db.run(COL_MODIFIED_SQL, now.getTime());
  });
  return true;
}

/** One deck on a preset, and the values it sets for itself (Deck.Normal), which the preset's don't reach. */
export interface PresetDeck {
  name: string;
  own: { newPerDay?: number; reviewsPerDay?: number; desiredRetention?: number };
}

export interface AnkiPreset {
  id: number;
  name: string;
  options: PresetOptions;
  /** Every normal deck that uses it, by name. */
  decks: PresetDeck[];
}

/**
 * A preset's options and the decks that use it, as the kept collection has them. A deck whose
 * preset is gone uses the Default preset (id 1), as Anki reads it (`buildExport` does the same).
 * Null when Anki has no such preset.
 */
export async function readAnkiPreset(db: SyncDb, presetId: number): Promise<AnkiPreset | null> {
  const row = await db.first<{ name: string; config: Uint8Array }>('SELECT name, config FROM deck_config WHERE id = ?', presetId);
  if (!row) return null;
  const c = readDeckConfig(row.config);
  const ids = new Set((await db.all<{ id: number }>('SELECT id FROM deck_config')).map((r) => Number(r.id)));
  // Anki's deck list leaves out the Default deck while it holds no cards, so this does too.
  const defaultEmpty = !(await db.first('SELECT 1 FROM cards WHERE did = 1 OR odid = 1 LIMIT 1'));
  const decks: PresetDeck[] = [];
  for (const d of await db.all<{ id: number; name: string; kind: Uint8Array }>('SELECT id, name, kind FROM decks NOT INDEXED')) {
    if (Number(d.id) === 1 && defaultEmpty) continue;
    const kind = readDeckKind(d.kind);
    if (!kind) continue;
    const uses = ids.has(kind.configId) ? kind.configId : 1;
    if (uses !== presetId) continue;
    const own: PresetDeck['own'] = {};
    if (kind.newLimit !== undefined) own.newPerDay = kind.newLimit;
    if (kind.reviewLimit !== undefined) own.reviewsPerDay = kind.reviewLimit;
    if (kind.desiredRetention !== undefined) own.desiredRetention = kind.desiredRetention;
    decks.push({ name: deckName(d.name), own });
  }
  decks.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return {
    id: presetId,
    name: row.name,
    options: {
      newPerDay: c.newPerDay,
      reviewsPerDay: c.reviewsPerDay,
      learnSteps: c.learnSteps,
      relearnSteps: c.relearnSteps,
      // Anki's defaults when the preset leaves them out.
      maxInterval: c.maxInterval || 36500,
      desiredRetention: c.desiredRetention ?? 0.9,
    },
    decks,
  };
}

/**
 * Sets a preset's daily limits, steps, maximum interval and desired retention. Only the options
 * that changed are rewritten, so a value Franki reads rounded (a step of a few seconds) keeps
 * Anki's own bits when it wasn't touched. False when Anki has no such preset.
 */
export async function setAnkiPresetOptions(db: SyncDb, presetId: number, options: PresetOptions, now: Date): Promise<boolean> {
  const current = await readAnkiPreset(db, presetId);
  if (!current) return false;
  const row = (await db.first<{ config: Uint8Array }>('SELECT config FROM deck_config WHERE id = ?', presetId))!;
  const was = current.options;
  const set: Record<number, Field[]> = {};
  const uintField = (v: number): Field[] => (v ? [{ wire: 0, value: BigInt(v) }] : []);
  const sameSteps = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-3);
  if (options.newPerDay !== was.newPerDay) set[F.newPerDay] = uintField(options.newPerDay);
  if (options.reviewsPerDay !== was.reviewsPerDay) set[F.reviewsPerDay] = uintField(options.reviewsPerDay);
  if (options.maxInterval !== was.maxInterval) set[F.maxInterval] = uintField(options.maxInterval);
  if (Math.abs(options.desiredRetention - was.desiredRetention) >= 1e-4) set[F.desiredRetention] = [floatField(options.desiredRetention)];
  if (!sameSteps(options.learnSteps, was.learnSteps)) set[F.learnSteps] = options.learnSteps.length ? [packedFloatsField(options.learnSteps)] : [];
  if (!sameSteps(options.relearnSteps, was.relearnSteps)) set[F.relearnSteps] = options.relearnSteps.length ? [packedFloatsField(options.relearnSteps)] : [];
  if (Object.keys(set).length === 0) return true;
  await writeConfig(db, presetId, withFields(row.config, set), now);
  return true;
}
