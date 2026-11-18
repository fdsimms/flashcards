import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readDeckConfig } from '../../src/anki/collection';
import { decodeMessage, uint } from '../../src/anki/protobuf';
import { setAnkiNewMix } from '../../src/anki/presetWrites';
import { nodeSyncDb } from '../support/syncDb';

const FIXTURE = join(__dirname, '..', 'fixtures', 'anki', 'collection.anki2');
const NOW = new Date(2026, 10, 11, 12);

async function kept() {
  const dir = mkdtempSync(join(tmpdir(), 'preset-'));
  copyFileSync(FIXTURE, join(dir, 'collection.anki2'));
  const db = await nodeSyncDb(join(dir, 'collection.anki2'), { unicase: true });
  await db.run('UPDATE deck_config SET usn = 0');
  return db;
}
const preset = async (db: Awaited<ReturnType<typeof kept>>) =>
  (await db.first<{ id: number; config: Uint8Array; mtime_secs: number; usn: number }>('SELECT id, config, mtime_secs, usn FROM deck_config ORDER BY id LIMIT 1'))!;

describe("a preset's new card order in the kept collection", () => {
  it('sets the order, marks the preset unsent and the collection modified, and keeps every other setting', async () => {
    const db = await kept();
    const before = await preset(db);
    expect(await setAnkiNewMix(db, before.id, 1, NOW)).toBe(true);
    const after = await preset(db);
    expect(readDeckConfig(after.config)).toEqual({ ...readDeckConfig(before.config), newMix: 1 });
    expect(after).toMatchObject({ usn: -1, mtime_secs: Math.floor(NOW.getTime() / 1000) });
    expect((await db.first<{ mod: number }>('SELECT mod FROM col'))!.mod).toBe(NOW.getTime());
    db.close();
  });

  it('writes the mix back to Anki\'s default (field left out) and keeps other fields exactly as they were', async () => {
    const db = await kept();
    const { id, config } = await preset(db);
    await setAnkiNewMix(db, id, 2, NOW);
    await setAnkiNewMix(db, id, 0, NOW);
    const msg = decodeMessage((await preset(db)).config);
    expect(uint(msg, 30)).toBeUndefined();
    // Every field other than the order is as Anki wrote it, in the same order.
    const fields = (b: Uint8Array) => [...decodeMessage(b)].filter(([n]) => n !== 30).map(([n, f]) => [n, f.map((x) => String(x.value))]);
    expect(fields((await preset(db)).config)).toEqual(fields(config));
    db.close();
  });

  it('changes nothing when the order is already set', async () => {
    const db = await kept();
    const { id } = await preset(db);
    expect(await setAnkiNewMix(db, id, 0, NOW)).toBe(true);
    expect(await preset(db)).toMatchObject({ usn: 0 });
    db.close();
  });

  it('is false for a preset Anki does not have', async () => {
    const db = await kept();
    expect(await setAnkiNewMix(db, 12345, 1, NOW)).toBe(false);
    db.close();
  });
});
