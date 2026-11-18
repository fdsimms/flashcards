import { decodeMessage, uint, withUint } from './protobuf';
import type { SyncDb } from './sync/collectionSync';
import { COL_MODIFIED_SQL } from './writeback';

/**
 * A change to a deck options preset, written into the kept Anki collection the way Anki writes
 * one (rslib's deckconfig update): the row's `config` edited in place so every setting Franki
 * doesn't read survives, `mtime_secs` set, `usn` -1 so the next sync sends it
 * (`deckConfigJson`), and the collection stamped modified. Runs on a connection of its own to
 * the kept collection (`withSyncConnection`), inside `lockAnki`.
 */

/** DeckConfig.Config.new_mix */
const NEW_MIX = 30;

/**
 * Sets a preset's "New/review order" (0 mix with reviews, 1 after reviews, 2 before reviews).
 * False when Anki has no such preset.
 */
export async function setAnkiNewMix(db: SyncDb, presetId: number, newMix: number, now: Date): Promise<boolean> {
  const row = await db.first<{ config: Uint8Array }>('SELECT config FROM deck_config WHERE id = ?', presetId);
  if (!row) return false;
  if ((uint(decodeMessage(row.config), NEW_MIX) ?? 0) === newMix) return true;
  const config = withUint(row.config, NEW_MIX, newMix);
  await db.transaction(async () => {
    await db.run('UPDATE deck_config SET config = ?, mtime_secs = ?, usn = -1 WHERE id = ?', config, Math.floor(now.getTime() / 1000), presetId);
    await db.run(COL_MODIFIED_SQL, now.getTime());
  });
  return true;
}
