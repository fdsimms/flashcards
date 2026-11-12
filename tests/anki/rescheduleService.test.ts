import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildExport } from '../../src/anki/collection';
import type { NoteStore } from '../../src/anki/noteService';
import { forgetCards, RescheduleRefused, setDueDates } from '../../src/anki/rescheduleService';
import { parseDueDate } from '../../src/core/reschedule';
import { newSchedState } from '../../src/core/scheduler';
import type { Card } from '../../src/core/types';
import { MemoryRepo } from '../../src/db/repo';
import { importAnkiJson } from '../../src/import/ankiJson';
import { readCollectionRows } from '../support/ankiRows';
import { nodeSyncDb } from '../support/syncDb';

const FIXTURE = join(__dirname, '..', 'fixtures', 'anki', 'collection.anki2');
const NOW = new Date(2026, 10, 11, 12);
const REVIEW = '1794408858014';
const FILTERED = '1794408858018';
const SUSPENDED = '1794408858019';

/** Franki after importing the fixture, with the kept collection beside it, and a fresh import of it to compare with. */
async function franki(opts: { kept?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'resched-'));
  const kept = join(dir, 'collection.anki2');
  copyFileSync(FIXTURE, kept);
  const read = async (into: MemoryRepo) => {
    const data = importAnkiJson(buildExport(await readCollectionRows(kept)), { now: NOW });
    await into.saveNoteTypes(data.noteTypes ?? []);
    await into.applyAnkiCollection(data.notes, data.cards);
    if (data.collectionSettings) await into.saveCollectionSettings(data.collectionSettings);
  };
  const repo = new MemoryRepo();
  await read(repo);
  const store = Object.assign(repo, {
    keptCollection: async () => (opts.kept === false ? null : {}),
    lockAnki: <T,>(fn: () => Promise<T>) => fn(),
    withSyncConnection: async <T,>(fn: (db: Awaited<ReturnType<typeof nodeSyncDb>>) => Promise<T>) => {
      const db = await nodeSyncDb(kept);
      try { return await fn(db); } finally { db.close(); }
    },
  }) as NoteStore & MemoryRepo;
  const reimported = async () => { const r = new MemoryRepo(); await read(r); return r; };
  const byAnkiId = async (r: MemoryRepo, id: string) => (await r.listCards()).find((c) => c.ankiId === id)!;
  return { store, reimported, byAnkiId };
}

// What a re-import would replace anyway, and the time it's read at.
const comparable = ({ ankiMod, ...c }: Card) => c;

describe('Forget', () => {
  it("makes an Anki card new in Franki exactly as reading Anki's collection back would", async () => {
    const { store, reimported, byAnkiId } = await franki();
    const [after] = await forgetCards(store, [await byAnkiId(store, REVIEW)], { resetCounts: false }, NOW);
    expect(after.sched).toMatchObject({ state: 0, reps: 2, lapses: 0 });
    expect(after.position).toBe(1);
    expect(comparable(await byAnkiId(store, REVIEW))).toEqual(comparable(after));
    expect(comparable(await byAnkiId(await reimported(), REVIEW))).toEqual(comparable(after));
  });

  it('brings a card home from a filtered deck, out of its suspension', async () => {
    const { store, reimported, byAnkiId } = await franki();
    const cards = [await byAnkiId(store, FILTERED), await byAnkiId(store, SUSPENDED)];
    expect(cards[0].filteredDeck).toBeDefined();
    expect(cards[1].suspended).toBe(true);
    const after = await forgetCards(store, cards, { resetCounts: true }, NOW);
    expect(after.map((c) => [c.filteredDeck, c.suspended, c.sched.reps])).toEqual([[undefined, false, 0], [undefined, false, 0]]);
    const again = await reimported();
    expect(comparable(await byAnkiId(again, FILTERED))).toEqual(comparable(after[0]));
    expect(comparable(await byAnkiId(again, SUSPENDED))).toEqual(comparable(after[1]));
  });

  it('changes a Franki-only card in Franki', async () => {
    const { store, byAnkiId } = await franki({ kept: false });
    const [after] = await forgetCards(store, [await byAnkiId(store, REVIEW)], { resetCounts: false }, NOW);
    expect(after.sched).toEqual({ ...newSchedState(NOW), reps: 2, lapses: 0 });
  });
});

describe('Set Due Date', () => {
  it("makes the card a review due that day in Franki, as reading Anki's collection back would", async () => {
    const { store, reimported, byAnkiId } = await franki();
    const [after] = await setDueDates(store, [await byAnkiId(store, SUSPENDED)], parseDueDate('3')!, NOW);
    expect(after.sched.state).toBe(2);
    expect(after.suspended).toBe(false);
    expect(comparable(await byAnkiId(await reimported(), SUSPENDED))).toEqual(comparable(after));
  });

  it("refuses when the collection's creation time isn't known", async () => {
    const { store, byAnkiId } = await franki();
    await store.saveCollectionSettings({ ...(await store.collectionSettings()), collectionCreated: undefined });
    await expect(setDueDates(store, [await byAnkiId(store, REVIEW)], parseDueDate('1')!, NOW)).rejects.toThrow(RescheduleRefused);
  });
});
