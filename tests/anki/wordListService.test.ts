import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildExport, deckName } from '../../src/anki/collection';
import type { NoteStore } from '../../src/anki/noteService';
import { importWordList, wordListSummary } from '../../src/anki/wordListService';
import { MemoryRepo } from '../../src/db/repo';
import { importAnkiJson } from '../../src/import/ankiJson';
import { reconcileIds } from '../../src/import/reconcile';
import { readCollectionRows } from '../support/ankiRows';
import { nodeSyncDb } from '../support/syncDb';

const FIXTURES = join(__dirname, '..', 'fixtures', 'anki');
const NOW = new Date(2026, 10, 11, 12);

/** What Anki 26.09's own import wrote for each file (make-textimport-vectors.py). */
interface Vector {
  name: string;
  deck: string;
  text: string;
  notes: { guid: string; notetype: string; tags: string; fields: string[]; cards: { ord: number; deck: string; type: number; queue: number; due: number }[] }[];
  nextPos: number;
}
const VECTORS: Vector[] = JSON.parse(readFileSync(join(FIXTURES, 'textimport-vectors.json'), 'utf8'));

/** Franki with the fixture collection kept, its decks read from it as an import reads them. */
async function franki(opts: { kept?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wordlist-'));
  const kept = join(dir, 'collection.anki2');
  copyFileSync(join(FIXTURES, 'collection.anki2'), kept);
  const repo = new MemoryRepo();
  const readIn = async () => {
    const data = reconcileIds(importAnkiJson(buildExport(await readCollectionRows(kept)), { now: NOW }), await repo.listNotes(), await repo.listCards());
    await repo.saveNoteTypes(data.noteTypes ?? []);
    await repo.applyAnkiCollection(data.notes, data.cards);
  };
  await readIn();
  let refreshed = 0;
  const store = Object.assign(repo, {
    keptCollection: async () => (opts.kept === false ? null : {}),
    lockAnki: <T,>(fn: () => Promise<T>) => fn(),
    withSyncConnection: async <T,>(fn: (db: Awaited<ReturnType<typeof nodeSyncDb>>) => Promise<T>) => {
      const db = await nodeSyncDb(kept, { unicase: true });
      try { return await fn(db); } finally { db.close(); }
    },
    ankiDecks: async () => {
      const db = await nodeSyncDb(kept);
      try { return (await db.all<{ id: number; name: string }>('SELECT id, name FROM decks')).map((d) => ({ id: Number(d.id), name: deckName(d.name) })); } finally { db.close(); }
    },
  }) as NoteStore & MemoryRepo & { ankiDecks: () => Promise<{ id: number; name: string }[]> };
  const refresh = async () => { refreshed++; await readIn(); };
  return { store, kept, refresh, refreshes: () => refreshed };
}

/** The collection's notes as the vectors list them: id order, each with its cards. */
async function collectionNotes(kept: string) {
  const db = await nodeSyncDb(kept, { unicase: true });
  const types = new Map((await db.all<{ id: number; name: string }>('SELECT id, name FROM notetypes NOT INDEXED')).map((t) => [Number(t.id), t.name]));
  const decks = new Map((await db.all<{ id: number; name: string }>('SELECT id, name FROM decks NOT INDEXED')).map((d) => [Number(d.id), deckName(d.name)]));
  const out = [];
  for (const n of await db.all<{ id: number; guid: string; mid: number; tags: string; flds: string }>('SELECT id, guid, mid, tags, flds FROM notes ORDER BY id')) {
    const cards = await db.all<{ ord: number; did: number; type: number; queue: number; due: number }>('SELECT ord, did, type, queue, due FROM cards WHERE nid = ? ORDER BY ord', n.id);
    out.push({ guid: n.guid, notetype: types.get(Number(n.mid)), tags: n.tags, fields: n.flds.split('\x1f'), cards: cards.map((c) => ({ ord: c.ord, deck: decks.get(Number(c.did)), type: c.type, queue: c.queue, due: c.due })) });
  }
  db.close();
  return out;
}

// A new note's guid is random, Anki's and Franki's alike, unless the file gave one.
const withoutNewGuids = (notes: any[], v: Vector) =>
  notes.map((n: any, i: number) => (i < 7 || v.text.includes(`${n.guid}\t`) ? n : { ...n, guid: '' }));

describe('a text file imported into the kept collection, as Anki imports it', () => {
  for (const v of VECTORS) {
    it(v.name, async () => {
      const { store, kept } = await franki();
      const result = await importWordList(store, v.text, 'words.txt', { deck: { name: v.deck }, refresh: async () => {} }, NOW);
      expect(result.frankiOnly).toBe(0);
      expect(withoutNewGuids(await collectionNotes(kept), v)).toEqual(withoutNewGuids(v.notes, v));
      const db = await nodeSyncDb(kept);
      const pos = await db.first<{ val: Uint8Array }>("SELECT val FROM config WHERE KEY = 'nextPos'");
      expect(Number(new TextDecoder().decode(pos!.val))).toBe(v.nextPos);
      db.close();
    });
  }

  it('counts what it added, updated and left, and reads the decks in again once it changed something', async () => {
    const { store, refresh, refreshes } = await franki();
    const text = '#separator:tab\n#html:true\n#notetype:Basic\nCapital of Peru?\tLima, on the coast\nCapital of Chile?\tSantiago\nCapital of Laos?\tVientiane\n';
    const result = await importWordList(store, text, 'words.txt', { deck: { name: '🧠 Trivia' }, refresh }, NOW);
    expect(result).toMatchObject({ added: 1, updated: 1, unchanged: 1, frankiOnly: 0 });
    expect(refreshes()).toBe(1);
    // Franki has the new note with the card Anki made for it.
    const laos = (await store.listNotes()).find((n) => n.fields.Front === 'Capital of Laos?')!;
    expect((await store.listCards()).find((c) => c.noteId === laos.id)?.ankiId).toBeDefined();
    const again = await importWordList(store, '#separator:tab\n#html:true\n#notetype:Basic\nCapital of Chile?\tSantiago\n', 'words.txt', { deck: { name: '🧠 Trivia' }, refresh }, NOW);
    expect(again).toMatchObject({ added: 0, updated: 0, unchanged: 1 });
    expect(refreshes()).toBe(1);
  });

  it("updates a word an earlier import left in Franki only there, and adds a note type Anki lacks to Franki only", async () => {
    const { store, kept } = await franki();
    await store.upsertNotesAndCards(
      [{ id: 'tsv:🧠 Trivia:Capital of Fiji?', deck: '🧠 Trivia', model: 'Basic', fields: { Front: 'Capital of Fiji?', Back: 'Suva' }, tags: [] }],
      [{ id: 'tsv:🧠 Trivia:Capital of Fiji?:t0', noteId: 'tsv:🧠 Trivia:Capital of Fiji?', kind: 't0', suspended: false, retired: false, sched: { due: NOW.toISOString(), stability: 0, difficulty: 0, elapsedDays: 0, scheduledDays: 0, learningSteps: 0, reps: 0, lapses: 0, state: 0, lastReview: null } } as any],
    );
    const before = (await collectionNotes(kept)).length;
    const result = await importWordList(store, '#separator:tab\n#html:true\n#notetype:Basic\nCapital of Fiji?\tSuva, on Viti Levu\n', 'words.txt', { deck: { name: '🧠 Trivia' }, refresh: async () => {} }, NOW);
    expect(result).toMatchObject({ added: 0, frankiOnly: 1 });
    expect(result.warnings).toContain('1 word came from an earlier import that kept it in Franki only, so it was updated there. Settings, Anki can move such words into Anki.');
    expect((await store.getNote('tsv:🧠 Trivia:Capital of Fiji?'))!.fields.Back).toBe('Suva, on Viti Levu');
    expect((await collectionNotes(kept)).length).toBe(before);

    const missing = await importWordList(store, '#separator:tab\n#notetype:Omnilanguage\nkot\tcat\n', 'words.txt', { deck: { name: '🧠 Trivia' }, refresh: async () => {} }, NOW);
    expect(missing.frankiOnly).toBe(1);
    expect(missing.warnings).toContain('The Anki collection has no note type called "Omnilanguage", so its notes were added to Franki only.');
  });

  it('keeps every note in Franki with no Anki collection, leaving a note from Anki alone', async () => {
    const { store, kept } = await franki({ kept: false });
    const before = await collectionNotes(kept);
    const result = await importWordList(store, '#separator:tab\n#html:true\n#notetype:Basic\nCapital of Peru?\tElsewhere\nCapital of Laos?\tVientiane\n', 'words.txt', { deck: { name: '🧠 Trivia' }, refresh: async () => {} }, NOW);
    expect(result).toMatchObject({ added: 0, frankiOnly: 1 });
    expect(result.warnings.some((w) => w.includes('is a note from Anki'))).toBe(true);
    expect(await collectionNotes(kept)).toEqual(before);
  });
});

describe('wordListSummary', () => {
  const r = { added: 0, updated: 0, unchanged: 0, frankiOnly: 0, warnings: [] };
  it('says where the notes went', () => {
    expect(wordListSummary('words.txt', { ...r, added: 40, updated: 3, unchanged: 2 })).toBe('Imported words.txt: 40 notes added to Anki, 3 updated and 2 unchanged.');
    expect(wordListSummary('words.txt', { ...r, updated: 1 })).toBe('Imported words.txt: 1 note updated.');
    expect(wordListSummary('words.txt', { ...r, frankiOnly: 12 })).toBe('Imported words.txt: 12 notes in Franki only.');
    expect(wordListSummary('words.txt', r)).toBe('Imported words.txt: no notes.');
  });
});
