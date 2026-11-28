import { prefsProblem, withPrefs, type CollectionPrefs } from '../core/collectionPrefs';
import { Refusal } from '../core/failure';
import type { CollectionSettings } from '../core/types';
import { utf8Encode } from './protobuf';
import { NO_COLLECTION, type NoteStore } from './noteService';
import type { SyncDb } from './sync/collectionSync';
import { stringifyJson } from './sync/json';
import { COL_MODIFIED_SQL } from './writeback';

/** Why the preferences can't be changed, with what to do, to show as it is. */
export class PrefsRefused extends Refusal {}

/**
 * The collection config values Anki keeps each preference in, and in what unit: the keys
 * `collectionSettings` (collection.ts) reads them from.
 */
const KEYS: { [K in keyof CollectionPrefs]: { key: string; value: (v: CollectionPrefs[K]) => unknown } } = {
  dayStartsAtHour: { key: 'rollover', value: (h) => h },
  learnAheadMinutes: { key: 'collapseTime', value: (m) => m * 60 },
  timeLimitMinutes: { key: 'timeLim', value: (m) => m * 60 },
  newCardsIgnoreReviewLimit: { key: 'newCardsIgnoreReviewLimit', value: (on) => on },
  applyAllParentLimits: { key: 'applyAllParentLimits', value: (on) => on },
  loadBalancer: { key: 'loadBalancerEnabled', value: (on) => on },
};

/**
 * Writes the preferences in `change` into the kept collection's config as Anki does (`set_config`):
 * one row per key with usn -1, and the collection stamped modified, so the next sync sends the
 * config to the server and every device follows.
 */
export async function setAnkiCollectionPrefs(db: SyncDb, change: Partial<CollectionPrefs>, now: Date): Promise<void> {
  const secs = Math.floor(now.getTime() / 1000);
  await db.transaction(async () => {
    for (const name of Object.keys(change) as (keyof CollectionPrefs)[]) {
      const v = change[name];
      if (v === undefined) continue;
      const { key, value } = KEYS[name] as { key: string; value: (v: unknown) => unknown };
      await db.run('INSERT OR REPLACE INTO config (KEY, usn, mtime_secs, val) VALUES (?, -1, ?, ?)', key, secs, utf8Encode(stringifyJson(value(v))));
    }
    await db.run(COL_MODIFIED_SQL, now.getTime());
  });
}

/**
 * Saves preferences: into the kept collection first, then into the settings Franki schedules with,
 * so the next count and session follow at once. Returns the settings as they now are. Refused with
 * no Anki collection: these belong to the collection, and Franki without one uses Anki's defaults.
 */
export async function saveCollectionPrefs(store: NoteStore, change: Partial<CollectionPrefs>, now: Date = new Date()): Promise<CollectionSettings> {
  const problem = prefsProblem(change);
  if (problem) throw new PrefsRefused(problem);
  if (!(await store.keptCollection())) throw new PrefsRefused(NO_COLLECTION);
  await store.lockAnki(() => store.withSyncConnection((db) => setAnkiCollectionPrefs(db, change, now)));
  const next = withPrefs(await store.collectionSettings(), change);
  await store.saveCollectionSettings(next);
  return next;
}
