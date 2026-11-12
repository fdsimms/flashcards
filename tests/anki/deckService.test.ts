import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildExport } from '../../src/anki/collection';
import { createDeck, deckDeletionPreview, DeckRefused, deleteDeck, moveDeck, renameDeck } from '../../src/anki/deckService';
import { deckMove } from '../../src/core/deckOrder';
import type { NoteStore } from '../../src/anki/noteService';
import { listedDecks } from '../../src/core/deckNames';
import { newSchedState } from '../../src/core/scheduler';
import { MemoryRepo } from '../../src/db/repo';
import { importAnkiJson } from '../../src/import/ankiJson';
import { readCollectionRows } from '../support/ankiRows';
import { nodeSyncDb } from '../support/syncDb';

const FIXTURE = join(__dirname, '..', 'fixtures', 'anki', 'collection.anki2');
const NOW = new Date(2026, 10, 12, 9);
const LANGUAGES = '👅 Languages';
const THAI = '👅 Languages::🐘 ภาษาไทย';
const TRIVIA = '🧠 Trivia';

/** Franki after importing the fixture, its kept collection with Anki's collation, and a refresh that reads it again. */
async function franki(opts: { kept?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'decksvc-'));
  const kept = join(dir, 'collection.anki2');
  copyFileSync(FIXTURE, kept);
  const repo = new MemoryRepo();
  const takeIn = async () => {
    const data = importAnkiJson(buildExport(await readCollectionRows(kept)), { now: NOW });
    await repo.saveNoteTypes(data.noteTypes ?? []);
    await repo.applyAnkiCollection(data.notes, data.cards);
    if (data.deckParams) await repo.saveDeckParams(data.deckParams);
  };
  await takeIn();
  let refreshes = 0;
  const refresh = async () => { refreshes++; await takeIn(); };
  const store = Object.assign(repo, {
    keptCollection: async () => (opts.kept === false ? null : {}),
    lockAnki: <T,>(fn: () => Promise<T>) => fn(),
    withSyncConnection: async <T,>(fn: (db: Awaited<ReturnType<typeof nodeSyncDb>>) => Promise<T>) => {
      const db = await nodeSyncDb(kept, { unicase: true });
      try { return await fn(db); } finally { db.close(); }
    },
  }) as NoteStore & MemoryRepo;
  const ankiDecks = async () => {
    const db = await nodeSyncDb(kept);
    try { return (await db.all<{ name: string }>('SELECT name FROM decks NOT INDEXED')).map((d) => d.name.split('\x1f').join('::')).sort(); } finally { db.close(); }
  };
  return { store, refresh, refreshes: () => refreshes, ankiDecks, anki: () => nodeSyncDb(kept) };
}

/** A note of Franki's own (a TSV import's), with one card. */
async function addOwnNote(repo: MemoryRepo, id: string, deck: string) {
  await repo.upsertNotesAndCards([{ id, deck, model: 'Basic', fields: { Front: id, Back: '' }, tags: [] }], [
    { id: `${id}:forward`, noteId: id, kind: 'forward', suspended: false, retired: false, sched: newSchedState(NOW) },
  ]);
}

const decksOfNotes = (repo: MemoryRepo) => [...new Set([...repo.notes.values()].map((n) => n.deck))].sort();

describe('making a deck', () => {
  it('makes it in Anki, with its parents, and reads the collection again so it has its preset here', async () => {
    const f = await franki();
    expect(await createDeck(f.store, ' Polski :: Nowy ', f.refresh, NOW)).toBe('Polski::Nowy');
    expect(await f.ankiDecks()).toEqual(expect.arrayContaining(['Polski', 'Polski::Nowy']));
    expect(f.refreshes()).toBe(1);
    expect(f.store.deckParams.get('Polski::Nowy')).toMatchObject({ presetId: 1 });
  });

  it('refuses a name Franki or Anki already has, whatever its case, and an empty one', async () => {
    const f = await franki();
    await addOwnNote(f.store, 'tsv:1', 'Słówka');
    await expect(createDeck(f.store, '🧠 TRIVIA', f.refresh, NOW)).rejects.toThrow('A deck called "🧠 Trivia" already exists.');
    await expect(createDeck(f.store, 'słówka', f.refresh, NOW)).rejects.toThrow('A deck called "Słówka" already exists.');
    // An empty deck only Anki has.
    await createDeck(f.store, 'Empty', f.refresh, NOW);
    await expect(createDeck(f.store, 'empty', f.refresh, NOW)).rejects.toThrow(DeckRefused);
    await expect(createDeck(f.store, '  ', f.refresh, NOW)).rejects.toThrow('Enter a name for the deck.');
  });

  it('without an Anki collection, keeps it in Franki, listed while it has no cards', async () => {
    const f = await franki({ kept: false });
    expect(await createDeck(f.store, '🧠 trivia::Mine', f.refresh, NOW)).toBe('🧠 Trivia::Mine');
    expect(f.refreshes()).toBe(0);
    expect(listedDecks([], await f.store.listDeckSettings())).toEqual(['🧠 Trivia::Mine']);
    expect(await f.ankiDecks()).not.toContain('🧠 Trivia::Mine');
  });
});

describe('renaming a deck', () => {
  it('renames it and its subdecks in Anki and in Franki, settings and Anki settings included', async () => {
    const f = await franki();
    await f.store.saveDeckSettings(THAI, { gateCap: 20 });
    await addOwnNote(f.store, 'tsv:1', THAI);
    expect(await renameDeck(f.store, LANGUAGES, 'Języki', f.refresh, NOW)).toBe('Języki');
    expect(await f.ankiDecks()).toEqual(expect.arrayContaining(['Języki', 'Języki::🐘 ภาษาไทย']));
    expect(decksOfNotes(f.store)).toEqual(['Języki::🐘 ภาษาไทย', TRIVIA]);
    expect(f.store.deckSettings.get('Języki::🐘 ภาษาไทย')).toEqual({ gateCap: 20 });
    expect(f.store.deckSettings.has(THAI)).toBe(false);
    expect([...f.store.deckParams.keys()].filter((d) => d.includes('Languages'))).toEqual([]);
    expect(f.store.deckParams.get('Języki::🐘 ภาษาไทย')).toBeDefined();
    expect(f.refreshes()).toBe(1);
  });

  it('refuses a name inside itself and one another deck has, changing nothing', async () => {
    const f = await franki();
    await expect(renameDeck(f.store, LANGUAGES, '👅 languages::Sub', f.refresh, NOW)).rejects.toThrow("can't go inside itself");
    await expect(renameDeck(f.store, THAI, 'filtered deck 1', f.refresh, NOW)).rejects.toThrow('A deck called "Filtered Deck 1" already exists.');
    await expect(renameDeck(f.store, THAI, '', f.refresh, NOW)).rejects.toThrow('Enter a name for the deck.');
    expect(await f.ankiDecks()).toContain(THAI);
    expect(f.refreshes()).toBe(0);
  });

  it('renames a deck Anki does not have in Franki only', async () => {
    const f = await franki();
    await addOwnNote(f.store, 'tsv:1', 'TSV::Words');
    await f.store.saveDeckSettings('TSV', { collapsed: true });
    expect(await renameDeck(f.store, 'TSV', '🧠 trivia::Imported', f.refresh, NOW)).toBe('🧠 Trivia::Imported');
    expect(f.store.notes.get('tsv:1')!.deck).toBe('🧠 Trivia::Imported::Words');
    expect(f.store.deckSettings.get('🧠 Trivia::Imported')).toEqual({ collapsed: true });
    expect(f.refreshes()).toBe(0);
    expect(await f.ankiDecks()).not.toContain('🧠 Trivia::Imported');
  });
});

describe('moving a deck by dragging it', () => {
  const LIST = [LANGUAGES, THAI, TRIVIA];

  it('nests it under its new parent in Anki and Franki, and saves its place among the subdecks there', async () => {
    const f = await franki();
    await f.store.saveDeckSettings(TRIVIA, { gateCap: 5, position: 1 });
    const move = deckMove(LIST, TRIVIA, LANGUAGES, 1)!;
    expect(await moveDeck(f.store, move, f.refresh, NOW)).toBe(`${LANGUAGES}::${TRIVIA}`);
    expect(await f.ankiDecks()).toContain(`${LANGUAGES}::${TRIVIA}`);
    expect(f.store.deckSettings.get(`${LANGUAGES}::${TRIVIA}`)).toEqual({ gateCap: 5, position: 0 });
    expect(f.store.deckSettings.get(THAI)).toEqual({ position: 1 });
    expect(f.refreshes()).toBe(1);
  });

  it('reorders without touching Anki, and unnests by renaming', async () => {
    const f = await franki();
    expect(await moveDeck(f.store, deckMove(LIST, TRIVIA, null, 0)!, f.refresh, NOW)).toBe(TRIVIA);
    expect(f.refreshes()).toBe(0);
    expect([TRIVIA, LANGUAGES].map((d) => f.store.deckSettings.get(d)?.position)).toEqual([0, 1]);
    // Thai dropped at the top level, after Languages and the subdecks inside it.
    expect(await moveDeck(f.store, deckMove([TRIVIA, LANGUAGES, THAI], THAI, LANGUAGES, 0)!, f.refresh, NOW)).toBe('🐘 ภาษาไทย');
    expect(await f.ankiDecks()).toContain('🐘 ภาษาไทย');
    expect([TRIVIA, LANGUAGES, '🐘 ภาษาไทย'].map((d) => f.store.deckSettings.get(d)?.position)).toEqual([0, 1, 2]);
  });

  it('refuses a name another deck has under the new parent, changing nothing', async () => {
    const f = await franki();
    await f.store.saveDeckSettings('🧠 Trivia::🐘 ภาษาไทย', { created: true });
    await addOwnNote(f.store, 'tsv:1', '🧠 Trivia::🐘 ภาษาไทย');
    await expect(moveDeck(f.store, deckMove([...LIST, '🧠 Trivia::🐘 ภาษาไทย'], THAI, TRIVIA, 1)!, f.refresh, NOW)).rejects.toThrow(DeckRefused);
    expect(await f.ankiDecks()).toContain(THAI);
    expect(f.store.deckSettings.get(THAI)).toBeUndefined();
  });
});

describe('deleting a deck', () => {
  it('says how many cards go, then deletes the deck, its cards and notes in Anki and Franki', async () => {
    const f = await franki();
    await f.store.saveDeckSettings(TRIVIA, { gateCap: 5 });
    // A card of Franki's own in the deck counts too.
    await addOwnNote(f.store, 'tsv:1', TRIVIA);
    expect(await deckDeletionPreview(f.store, TRIVIA)).toEqual({ cards: 7, inAnki: true, keepsDeck: false });
    await deleteDeck(f.store, TRIVIA, f.refresh, NOW);
    expect(decksOfNotes(f.store)).toEqual([THAI]);
    // Its card that was in Filtered Deck 1 went with it.
    expect([...f.store.cards.values()].some((c) => c.filteredDeck)).toBe(false);
    expect(f.store.deckSettings.has(TRIVIA)).toBe(false);
    expect(f.store.deckParams.has(TRIVIA)).toBe(false);
    expect(await f.ankiDecks()).not.toContain(TRIVIA);
    const db = await f.anki();
    expect((await db.all('SELECT oid FROM graves WHERE type = 2'))).toEqual([{ oid: 1794408857991 }]);
    db.close();
    expect(f.refreshes()).toBe(1);
  });

  it('deletes a parent with its subdecks', async () => {
    const f = await franki();
    await deleteDeck(f.store, LANGUAGES, f.refresh, NOW);
    expect(decksOfNotes(f.store)).toEqual([TRIVIA]);
    expect(await f.ankiDecks()).not.toContain(THAI);
  });

  it('empties Anki\'s Default deck but keeps it, as Anki does', async () => {
    const f = await franki();
    expect(await deckDeletionPreview(f.store, 'Default')).toEqual({ cards: 0, inAnki: true, keepsDeck: true });
    await deleteDeck(f.store, 'Default', f.refresh, NOW);
    expect(await f.ankiDecks()).toContain('Default');
  });

  it('deletes a deck Anki does not have from Franki only', async () => {
    const f = await franki();
    await addOwnNote(f.store, 'tsv:1', 'TSV');
    await addOwnNote(f.store, 'tsv:2', 'TSV::Sub');
    await f.store.saveDeckSettings('TSV::Sub', { created: true });
    expect(await deckDeletionPreview(f.store, 'TSV')).toEqual({ cards: 2, inAnki: false, keepsDeck: false });
    await deleteDeck(f.store, 'TSV', f.refresh, NOW);
    expect(f.store.notes.has('tsv:1') || f.store.notes.has('tsv:2')).toBe(false);
    expect(f.store.deckSettings.has('TSV::Sub')).toBe(false);
    expect(f.refreshes()).toBe(0);
  });
});
