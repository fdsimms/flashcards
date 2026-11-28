import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyRetentionChange, countRetentionReschedule } from '../../src/anki/retentionWrites';
import { utf8Encode } from '../../src/anki/protobuf';
import { nodeSyncDb } from '../support/syncDb';

const FIXTURES = join(__dirname, '..', 'fixtures', 'anki');
const NOW = new Date(2026, 10, 11, 12);

/** What Anki 26.09 wrote for each case (make-retention-vectors.py). */
interface Vector {
  name: string;
  preset: number;
  retention: number;
  reschedule: boolean;
  setup: string[];
  loadBalancer: boolean;
  today: number;
  nextDayAt: number;
  rows: Record<string, any>[];
  revlog: Record<string, number>[];
}
const VECTORS: Vector[] = JSON.parse(readFileSync(join(FIXTURES, 'retention-vectors.json'), 'utf8'));

async function kept(v: Vector) {
  const dir = mkdtempSync(join(tmpdir(), 'retention-'));
  copyFileSync(join(FIXTURES, 'collection.anki2'), join(dir, 'collection.anki2'));
  const db = await nodeSyncDb(join(dir, 'collection.anki2'));
  for (const sql of v.setup) await db.run(sql);
  await db.run("INSERT OR REPLACE INTO config (KEY, usn, mtime_secs, val) VALUES ('loadBalancerEnabled', 0, 0, ?)", utf8Encode(String(v.loadBalancer)));
  return db;
}

// Card data is compared as JSON, not text: Anki writes 1.0 where JavaScript writes 1, and reads either.
const comparable = (r: any) => ({ ...r, data: JSON.parse(r.data || '{}') });
const before = (v: Vector) => VECTORS.find((w) => w.setup.join() === v.setup.join() && !w.reschedule && w.preset === v.preset);

describe('a retention change in the kept collection, as Anki writes it', () => {
  for (const v of VECTORS) {
    it(v.name, async () => {
      const db = await kept(v);
      const counted = await countRetentionReschedule(db, v.preset);
      let result!: { rescheduled: number };
      await db.transaction(async () => {
        result = await applyRetentionChange(db, { presetId: v.preset, retention: v.retention, reschedule: v.reschedule, today: v.today, nextDayStartSecs: v.nextDayAt }, NOW);
      });
      const rows = await db.all<any>('SELECT id, did, odid, odue, type, queue, due, ivl, factor, reps, lapses, data FROM cards ORDER BY id');
      expect(rows.map(comparable)).toEqual(v.rows.map(comparable));
      const revlog = await db.all<any>('SELECT cid, usn, ease, ivl, lastIvl, factor, time, type FROM revlog WHERE type = 5 ORDER BY id');
      expect(revlog).toEqual(v.revlog);
      // The count the screen asks about is what rescheduling then moves.
      if (v.reschedule) expect(result.rescheduled).toBe(counted);
      expect(result.rescheduled).toBe(v.revlog.length);
      db.close();
    });
  }

  it('sends only the cards it changed, and stamps the collection', async () => {
    const v = VECTORS.find((w) => w.name.includes('keeping dates'))!;
    const db = await kept(v);
    await db.transaction(async () => {
      await applyRetentionChange(db, { presetId: v.preset, retention: v.retention, reschedule: false, today: v.today, nextDayStartSecs: v.nextDayAt }, NOW);
    });
    const changed = await db.all<{ id: number; usn: number }>('SELECT id, usn FROM cards WHERE mod = ? ORDER BY id', Math.floor(NOW.getTime() / 1000));
    // The Thai deck's three studied cards take the new retention; nothing else is touched.
    expect(changed.map((r) => r.id)).toEqual([1794408858014, 1794408858015, 1794408858016]);
    expect(changed.every((r) => r.usn === -1)).toBe(true);
    expect((await db.first<{ mod: number }>('SELECT mod FROM col'))!.mod).toBe(NOW.getTime());
    db.close();
  });
});
