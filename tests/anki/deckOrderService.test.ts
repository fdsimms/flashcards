import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildExport } from '../../src/anki/collection';
import { DeckOrderRefused, setNewCardOrder } from '../../src/anki/deckOrderService';
import type { NoteStore } from '../../src/anki/noteService';
import { newCardOrderOf } from '../../src/core/newCardOrder';
import { MemoryRepo } from '../../src/db/repo';
import { importAnkiJson } from '../../src/import/ankiJson';
import { readCollectionRows } from '../support/ankiRows';
import { nodeSyncDb } from '../support/syncDb';

const FIXTURE = join(__dirname, '..', 'fixtures', 'anki', 'collection.anki2');
const NOW = new Date(2026, 10, 11, 12);
const TRIVIA = '🧠 Trivia';

async function franki(opts: { kept?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ordersvc-'));
  const kept = join(dir, 'collection.anki2');
  copyFileSync(FIXTURE, kept);
  const repo = new MemoryRepo();
  const data = importAnkiJson(buildExport(await readCollectionRows(kept)), { now: NOW });
  await repo.saveNoteTypes(data.noteTypes ?? []);
  await repo.applyAnkiCollection(data.notes, data.cards);
  if (data.deckParams?.size) await repo.saveDeckParams(data.deckParams);
  const store = Object.assign(repo, {
    keptCollection: async () => (opts.kept === false ? null : {}),
    lockAnki: <T,>(fn: () => Promise<T>) => fn(),
    withSyncConnection: async <T,>(fn: (db: Awaited<ReturnType<typeof nodeSyncDb>>) => Promise<T>) => {
      const db = await nodeSyncDb(kept, { unicase: true });
      try { return await fn(db); } finally { db.close(); }
    },
  }) as NoteStore & MemoryRepo;
  return { store, anki: () => nodeSyncDb(kept, { unicase: true }) };
}

describe("setting a deck's new card order", () => {
  it("changes the preset in the collection, marked unsent, and every deck of Franki's that uses it", async () => {
    const { store, anki } = await franki();
    const before = newCardOrderOf(TRIVIA, await store.listDeckParams())!;
    expect(before.mix).toBe(0);
    await setNewCardOrder(store, TRIVIA, 1, NOW);
    const after = await store.listDeckParams();
    expect(newCardOrderOf(TRIVIA, after)!.mix).toBe(1);
    for (const name of before.sharedWith) expect(after.get(name)!.order!.newMix).toBe(1);
    const db = await anki();
    const row = (await db.first<{ usn: number }>('SELECT usn FROM deck_config WHERE id = ?', before.presetId))!;
    expect(row.usn).toBe(-1);
    db.close();
  });

  it('refuses a deck with no Anki preset, and a Franki with no Anki collection', async () => {
    const { store } = await franki();
    await expect(setNewCardOrder(store, 'Nope', 1, NOW)).rejects.toBeInstanceOf(DeckOrderRefused);
    const none = await franki({ kept: false });
    await expect(setNewCardOrder(none.store, TRIVIA, 1, NOW)).rejects.toThrow('Anki collection');
    expect(newCardOrderOf(TRIVIA, await none.store.listDeckParams())!.mix).toBe(0);
  });
});
