import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildExport } from '../../src/anki/collection';
import { emptyFilteredDeckNamed, loadFilteredDeck, rebuildFilteredDeck, saveFilteredDeckFor } from '../../src/anki/filteredDeckService';
import type { NoteStore } from '../../src/anki/noteService';
import { newFilteredDeck } from '../../src/core/filteredDeck';
import { MemoryRepo } from '../../src/db/repo';
import { importAnkiJson } from '../../src/import/ankiJson';
import { reconcileIds } from '../../src/import/reconcile';
import { readCollectionRows } from '../support/ankiRows';
import { nodeSyncDb } from '../support/syncDb';

const FIXTURE = join(__dirname, '..', 'fixtures', 'anki', 'collection.anki2');
const NOW = new Date(2026, 10, 20, 12);

async function franki(opts: { kept?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'filteredsvc-'));
  const kept = join(dir, 'collection.anki2');
  copyFileSync(FIXTURE, kept);
  const repo = new MemoryRepo();
  const readIn = async () => {
    const data = reconcileIds(importAnkiJson(buildExport(await readCollectionRows(kept)), { now: NOW }), await repo.listNotes(), await repo.listCards());
    await repo.saveNoteTypes(data.noteTypes ?? []);
    await repo.applyAnkiCollection(data.notes, data.cards);
    if (data.deckParams?.size) await repo.saveDeckParams(data.deckParams);
    if (data.collectionSettings) await repo.saveCollectionSettings(data.collectionSettings);
  };
  await readIn();
  const store = Object.assign(repo, {
    keptCollection: async () => (opts.kept === false ? null : {}),
    lockAnki: <T,>(fn: () => Promise<T>) => fn(),
    withSyncConnection: async <T,>(fn: (db: Awaited<ReturnType<typeof nodeSyncDb>>) => Promise<T>) => {
      const db = await nodeSyncDb(kept, { unicase: true });
      try { return await fn(db); } finally { db.close(); }
    },
  }) as NoteStore & MemoryRepo;
  return { store, readIn };
}

describe('filtered decks from the app', () => {
  it('builds, reads back, rebuilds and empties, and Franki follows each time', async () => {
    const { store, readIn } = await franki();
    const made = await saveFilteredDeckFor(store, undefined, { ...newFilteredDeck('is:new'), name: 'New words' }, readIn, NOW);
    expect(made).toEqual({ name: 'New words', count: 5 });
    expect((await store.listCards()).filter((c) => c.filteredDeck === 'New words')).toHaveLength(5);
    expect((await loadFilteredDeck(store, 'New words')).terms).toEqual([{ search: 'is:new', limit: 100, order: 1 }]);
    expect(await rebuildFilteredDeck(store, 'New words', readIn, NOW)).toBe(5);
    expect(await emptyFilteredDeckNamed(store, 'New words', readIn, NOW)).toBe(5);
    expect((await store.listCards()).filter((c) => c.filteredDeck === 'New words')).toHaveLength(0);
  });

  it('changes a deck it has, by name', async () => {
    const { store, readIn } = await franki();
    await saveFilteredDeckFor(store, undefined, { ...newFilteredDeck('is:new'), name: 'Mine' }, readIn, NOW);
    const changed = await saveFilteredDeckFor(store, 'Mine', { ...newFilteredDeck('is:review'), name: 'Reviews' }, readIn, NOW);
    expect(changed.name).toBe('Reviews');
    await expect(loadFilteredDeck(store, 'Mine')).rejects.toThrow("doesn't have this filtered deck");
  });

  it('refuses a form it can\'t save, and works only with a collection', async () => {
    const { store, readIn } = await franki();
    await expect(saveFilteredDeckFor(store, undefined, { ...newFilteredDeck('is:'), name: 'x' }, readIn, NOW)).rejects.toThrow("can't be read");
    const none = await franki({ kept: false });
    await expect(saveFilteredDeckFor(none.store, undefined, { ...newFilteredDeck('is:new'), name: 'x' }, none.readIn, NOW)).rejects.toThrow('Anki collection');
  });
});
