import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildExport } from '../../src/anki/collection';
import { saveCollectionPrefs, setAnkiCollectionPrefs } from '../../src/anki/collectionPrefsService';
import type { NoteStore } from '../../src/anki/noteService';
import { MemoryRepo } from '../../src/db/repo';
import { readCollectionRows } from '../support/ankiRows';
import { nodeSyncDb } from '../support/syncDb';

const FIXTURE = join(__dirname, '..', 'fixtures', 'anki', 'collection.anki2');
const NOW = new Date(2026, 10, 11, 12);

function keptCopy() {
  const dir = mkdtempSync(join(tmpdir(), 'prefs-'));
  const kept = join(dir, 'collection.anki2');
  copyFileSync(FIXTURE, kept);
  return kept;
}

describe('collection preferences in the kept collection', () => {
  it('are read back by the collection reader as written, in its units', async () => {
    const kept = keptCopy();
    const db = await nodeSyncDb(kept);
    await setAnkiCollectionPrefs(db, { dayStartsAtHour: 6, learnAheadMinutes: 45, timeLimitMinutes: 25, newCardsIgnoreReviewLimit: true, applyAllParentLimits: true, loadBalancer: false }, NOW);
    const rows = await db.all<{ key: string; usn: number; mtime_secs: number }>("SELECT KEY AS key, usn, mtime_secs FROM config WHERE KEY IN ('rollover', 'collapseTime', 'timeLim', 'newCardsIgnoreReviewLimit', 'applyAllParentLimits', 'loadBalancerEnabled')");
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.usn === -1 && r.mtime_secs === Math.floor(NOW.getTime() / 1000))).toBe(true);
    expect((await db.first<{ mod: number }>('SELECT mod FROM col'))!.mod).toBe(NOW.getTime());
    db.close();
    const cs = buildExport(await readCollectionRows(kept)).collectionSettings;
    expect(cs).toMatchObject({ dayStartsAtHour: 6, learnAheadMinutes: 45, timeLimitSecs: 1500, newCardsIgnoreReviewLimit: true, applyAllParentLimits: true, loadBalancer: false });
  });

  it('writes only what changed, and Franki schedules with it at once', async () => {
    const kept = keptCopy();
    const repo = new MemoryRepo();
    const before = buildExport(await readCollectionRows(kept)).collectionSettings;
    await repo.saveCollectionSettings(before);
    const store = Object.assign(repo, {
      keptCollection: async () => ({}),
      lockAnki: <T,>(fn: () => Promise<T>) => fn(),
      withSyncConnection: async <T,>(fn: (db: Awaited<ReturnType<typeof nodeSyncDb>>) => Promise<T>) => {
        const db = await nodeSyncDb(kept);
        try { return await fn(db); } finally { db.close(); }
      },
    }) as NoteStore & MemoryRepo;
    await saveCollectionPrefs(store, { learnAheadMinutes: 5 }, NOW);
    expect(await repo.collectionSettings()).toEqual({ ...before, learnAheadMinutes: 5 });
    expect(buildExport(await readCollectionRows(kept)).collectionSettings).toEqual({ ...before, learnAheadMinutes: 5 });
  });

  it('is refused with no Anki collection, and for an hour outside the day', async () => {
    const repo = Object.assign(new MemoryRepo(), { keptCollection: async () => null, lockAnki: <T,>(fn: () => Promise<T>) => fn(), withSyncConnection: async () => { throw new Error('no'); } }) as unknown as NoteStore;
    await expect(saveCollectionPrefs(repo, { learnAheadMinutes: 5 }, NOW)).rejects.toThrow('no Anki collection');
    await expect(saveCollectionPrefs(repo, { dayStartsAtHour: 30 }, NOW)).rejects.toThrow('hour');
  });
});
