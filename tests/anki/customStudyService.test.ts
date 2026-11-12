import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildExport } from '../../src/anki/collection';
import { runCustomStudy } from '../../src/anki/customStudyService';
import { CustomStudyRefused } from '../../src/anki/customStudyWrites';
import type { NoteStore } from '../../src/anki/noteService';
import { deckJson } from '../../src/anki/sync/deckRows';
import { CUSTOM_STUDY_DECK } from '../../src/core/customStudy';
import { deckLimits, queueInput, treeQueue } from '../../src/core/deckTree';
import { paramsForDeck } from '../../src/core/scheduler';
import { MemoryRepo } from '../../src/db/repo';
import { importAnkiJson } from '../../src/import/ankiJson';
import { readCollectionRows } from '../support/ankiRows';
import { nodeSyncDb } from '../support/syncDb';

const FIXTURE = join(__dirname, '..', 'fixtures', 'anki', 'collection.anki2');
const NOW = new Date(2026, 10, 11, 12);
const TRIVIA = '🧠 Trivia';

/** Franki as the app has it after importing the fixture, with the kept collection beside it. */
async function franki(opts: { kept?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cssvc-'));
  const kept = join(dir, 'collection.anki2');
  copyFileSync(FIXTURE, kept);
  const repo = new MemoryRepo();
  const take = async () => {
    const data = importAnkiJson(buildExport(await readCollectionRows(kept)), { now: NOW });
    await repo.saveNoteTypes(data.noteTypes ?? []);
    await repo.applyAnkiCollection(data.notes, data.cards);
    if (data.deckParams?.size) await repo.saveDeckParams(data.deckParams);
    if (data.collectionSettings) await repo.saveCollectionSettings(data.collectionSettings);
  };
  await take();
  const store = Object.assign(repo, {
    keptCollection: async () => (opts.kept === false ? null : {}),
    lockAnki: <T,>(fn: () => Promise<T>) => fn(),
    withSyncConnection: async <T,>(fn: (db: Awaited<ReturnType<typeof nodeSyncDb>>) => Promise<T>) => {
      const db = await nodeSyncDb(kept, { unicase: true });
      try { return await fn(db); } finally { db.close(); }
    },
  }) as NoteStore & MemoryRepo;
  return { store, take, anki: () => nodeSyncDb(kept, { unicase: true }) };
}

describe('increasing a deck\'s limit for today', () => {
  it("adds to the limit the deck has today, in Franki's settings and in the collection, so a sync carries it", async () => {
    const { store, take, anki } = await franki();
    const before = deckLimits(paramsForDeck(TRIVIA, await store.listDeckParams()), { newPerDay: 20, reviewsPerDay: 200 }, '2026-11-11');
    expect(before.newPerDay).toBe(3);
    expect(await runCustomStudy(store, TRIVIA, { kind: 'moreNew', count: 10 }, take, NOW)).toEqual({ kind: 'limits' });
    const params = await store.listDeckParams();
    expect(deckLimits(paramsForDeck(TRIVIA, params), { newPerDay: 20, reviewsPerDay: 200 }, '2026-11-11').newPerDay).toBe(13);
    // Tomorrow the preset's limit is back.
    expect(deckLimits(paramsForDeck(TRIVIA, params), { newPerDay: 20, reviewsPerDay: 200 }, '2026-11-12').newPerDay).toBe(3);
    // The collection holds the same, so reading it back changes nothing, and a second increase adds to the first.
    const db = await anki();
    const decks = await db.all<any>('SELECT * FROM decks NOT INDEXED');
    const d = decks.find((r) => r.name === TRIVIA)!;
    expect(deckJson({ id: d.id, name: d.name, mtime: d.mtime_secs, usn: d.usn, common: d.common, kind: d.kind }).newLimitToday).toMatchObject({ limit: 13 });
    db.close();
    await runCustomStudy(store, TRIVIA, { kind: 'moreNew', count: 5 }, take, NOW);
    expect(deckLimits(paramsForDeck(TRIVIA, await store.listDeckParams()), { newPerDay: 20, reviewsPerDay: 200 }, '2026-11-11').newPerDay).toBe(18);
  });

  it('raises the review limit apart from the new one', async () => {
    const { store, take } = await franki();
    await runCustomStudy(store, TRIVIA, { kind: 'moreReviews', count: 50 }, take, NOW);
    const l = deckLimits(paramsForDeck(TRIVIA, await store.listDeckParams()), { newPerDay: 20, reviewsPerDay: 200 }, '2026-11-11');
    expect(l.newPerDay).toBe(3);
    expect(l.reviewsPerDay).toBeGreaterThan(50);
  });

  it("refuses more new cards for a deck with a progress gate, which has no daily limit to raise", async () => {
    const { store, take } = await franki();
    await store.saveDeckSettings(TRIVIA, { gateCap: 50 });
    await expect(runCustomStudy(store, TRIVIA, { kind: 'moreNew', count: 5 }, take, NOW)).rejects.toThrow('progress gate');
  });

  it('refuses an amount that is not a whole number of cards', async () => {
    const { store, take } = await franki();
    await expect(runCustomStudy(store, TRIVIA, { kind: 'moreNew', count: 0 }, take, NOW)).rejects.toBeInstanceOf(CustomStudyRefused);
  });
});

describe('studying cards in a custom study session', () => {
  it('moves the cards in the collection, reads them back, and the session deck then has them to study', async () => {
    const { store, take } = await franki();
    const r = await runCustomStudy(store, TRIVIA, { kind: 'cram', select: 'new', count: 100, include: [], exclude: [] }, take, NOW);
    expect(r).toEqual({ kind: 'deck', deck: CUSTOM_STUDY_DECK, moved: 4 });
    const cards = await store.listCards();
    expect(cards.filter((c) => c.filteredDeck === CUSTOM_STUDY_DECK)).toHaveLength(4);
    const params = await store.listDeckParams();
    expect(params.get(CUSTOM_STUDY_DECK)?.filtered).toMatchObject({ reschedule: false });
    const notes = await store.listNotes();
    const cs = await store.collectionSettings();
    const queue = treeQueue(CUSTOM_STUDY_DECK, queueInput({ notes, cards, params, studied: new Map(), collection: cs, now: NOW }));
    expect(queue.order).toHaveLength(4);
  });

  it('needs the Anki collection', async () => {
    const { store, take } = await franki({ kept: false });
    await expect(runCustomStudy(store, TRIVIA, { kind: 'forgotten', days: 1 }, take, NOW)).rejects.toThrow('Anki collection');
  });

  it('says when no card matches', async () => {
    const { store, take } = await franki();
    await expect(runCustomStudy(store, TRIVIA, { kind: 'forgotten', days: 1 }, take, NOW)).rejects.toThrow('No cards match');
  });
});
