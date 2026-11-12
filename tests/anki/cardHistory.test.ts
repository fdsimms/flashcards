import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cardHistory } from '../../src/anki/cardHistory';
import { newSchedState } from '../../src/core/scheduler';
import type { Card } from '../../src/core/types';
import { MemoryRepo } from '../../src/db/repo';
import { nodeSyncDb } from '../support/syncDb';

const FIXTURE = join(__dirname, '..', 'fixtures', 'anki', 'collection.anki2');
const REVIEW = '1794408858014';

async function store(kept: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'history-'));
  copyFileSync(FIXTURE, join(dir, 'collection.anki2'));
  return Object.assign(new MemoryRepo(), {
    keptCollection: async () => (kept ? {} : null),
    lockAnki: <T,>(fn: () => Promise<T>) => fn(),
    withSyncConnection: async <T,>(fn: (db: Awaited<ReturnType<typeof nodeSyncDb>>) => Promise<T>) => {
      const db = await nodeSyncDb(join(dir, 'collection.anki2'));
      try { return await fn(db); } finally { db.close(); }
    },
  });
}

const card: Card = { id: 'c1', noteId: 'n1', kind: 't0', ankiId: REVIEW, suspended: false, retired: false, sched: newSchedState() };

describe('cardHistory', () => {
  it("reads an Anki card's history from the kept collection's review log", async () => {
    const s = await store(true);
    const rows = await s.withSyncConnection((db) => db.all<{ id: number }>('SELECT id FROM revlog WHERE cid = ?', Number(REVIEW)));
    expect(rows.length).toBeGreaterThan(0);
    expect((await cardHistory(s, card)).map((h) => h.at.getTime())).toEqual(rows.map((r) => r.id).sort((a, b) => b - a));
  });

  it("reads Franki's own answers without a kept collection", async () => {
    const s = await store(false);
    await s.addReview({ cardId: 'c1', rating: 3, reviewedAt: new Date(2026, 10, 11, 12).toISOString(), state: 2, due: new Date(2026, 10, 14, 12).toISOString(), stability: 3, difficulty: 5 });
    expect((await cardHistory(s, card)).map((h) => [h.rating, h.interval])).toEqual([[3, '3d']]);
  });
});
