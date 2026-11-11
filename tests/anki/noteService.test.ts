import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildExport } from '../../src/anki/collection';
import { deleteNote, NoteRefused, saveNote, type NoteStore } from '../../src/anki/noteService';
import { review } from '../../src/core/scheduler';
import { MemoryRepo } from '../../src/db/repo';
import { importAnkiJson } from '../../src/import/ankiJson';
import { readCollectionRows } from '../support/ankiRows';
import { nodeSyncDb } from '../support/syncDb';

const FIXTURE = join(__dirname, '..', 'fixtures', 'anki', 'collection.anki2');
const NOW = new Date(2026, 10, 11, 12);

/** Franki as the app has it after importing the fixture: its tables, and the kept collection. */
async function franki(opts: { kept?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'notesvc-'));
  const kept = join(dir, 'collection.anki2');
  copyFileSync(FIXTURE, kept);
  const repo = new MemoryRepo();
  const data = importAnkiJson(buildExport(await readCollectionRows(kept)), { now: NOW });
  await repo.saveNoteTypes(data.noteTypes ?? []);
  await repo.applyAnkiCollection(data.notes, data.cards);
  const store = Object.assign(repo, {
    keptCollection: async () => (opts.kept === false ? null : {}),
    lockAnki: <T,>(fn: () => Promise<T>) => fn(),
    withSyncConnection: async <T,>(fn: (db: Awaited<ReturnType<typeof nodeSyncDb>>) => Promise<T>) => {
      const db = await nodeSyncDb(kept);
      try { return await fn(db); } finally { db.close(); }
    },
  }) as NoteStore & MemoryRepo;
  const anki = () => nodeSyncDb(kept);
  return { store, anki };
}

describe('saving a note', () => {
  it('adds a note to an Anki deck in both places, its cards linked to Anki\'s', async () => {
    const { store, anki } = await franki();
    const note = await saveNote(store, { deck: '🧠 Trivia', model: 'Basic (and reversed card)', fields: { Front: 'Capital of Uruguay?', Back: 'Montevideo' }, tags: ['geo'] }, NOW);
    expect(note.id).toMatch(/^\d+$/);
    const cards = [...store.cards.values()].filter((c) => c.noteId === note.id);
    expect(cards.map((c) => c.kind).sort()).toEqual(['t0', 't1']);
    const db = await anki();
    const ankiCards = await db.all<{ id: number; ord: number }>('SELECT id, ord FROM cards WHERE nid = ? ORDER BY ord', Number(note.id));
    expect(cards.map((c) => [c.kind, Number(c.ankiId)]).sort()).toEqual(ankiCards.map((c) => [`t${c.ord}`, c.id]));
    db.close();
  });

  it('edits a note, keeping each card\'s schedule and Anki link, and adding a card it now generates', async () => {
    const { store, anki } = await franki();
    const n = await saveNote(store, { deck: '🧠 Trivia', model: 'Basic (and reversed card)', fields: { Front: 'Capital of Paraguay?', Back: '' }, tags: [] }, NOW);
    const first = [...store.cards.values()].find((c) => c.noteId === n.id)!;
    const studied = { ...first, sched: review(first.sched, 3, NOW).sched };
    await store.saveCard(studied);
    await saveNote(store, { id: n.id, deck: n.deck, model: n.model, fields: { Front: 'Capital of Paraguay?', Back: 'Asunción' }, tags: ['geo'] }, NOW);
    const cards = [...store.cards.values()].filter((c) => c.noteId === n.id).sort((a, b) => a.kind.localeCompare(b.kind));
    expect(cards.map((c) => c.kind)).toEqual(['t0', 't1']);
    expect(cards[0]).toMatchObject({ ankiId: first.ankiId, sched: studied.sched });
    expect(cards[1].ankiId).toMatch(/^\d+$/);
    expect((await store.getNote(n.id))!.fields.Back).toBe('Asunción');
    const db = await anki();
    expect(await db.first('SELECT flds, tags FROM notes WHERE id = ?', Number(n.id))).toEqual({ flds: 'Capital of Paraguay?\x1fAsunción', tags: ' geo ' });
    db.close();
  });

  it('refuses a note that makes no cards, saying what to fill in', async () => {
    const { store } = await franki();
    await expect(saveNote(store, { deck: '🧠 Trivia', model: 'Basic', fields: { Front: '', Back: 'x' }, tags: [] }, NOW)).rejects.toBeInstanceOf(NoteRefused);
  });

  it('keeps a note in a deck Anki doesn\'t have, or with no Anki collection, in Franki only', async () => {
    const { store, anki } = await franki();
    const n = await saveNote(store, { deck: 'Franki only', model: 'Basic', fields: { Front: 'a', Back: 'b' }, tags: [] }, NOW);
    expect(n.id).toMatch(/^franki:/);
    expect([...store.cards.values()].filter((c) => c.noteId === n.id).every((c) => !c.ankiId)).toBe(true);
    const db = await anki();
    expect((await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM notes WHERE flds = 'a\x1fb'"))!.n).toBe(0);
    db.close();
    const alone = await franki({ kept: false });
    expect((await saveNote(alone.store, { deck: '🧠 Trivia', model: 'Basic', fields: { Front: 'a', Back: 'b' }, tags: [] }, NOW)).id).toMatch(/^franki:/);
  });
});

describe('deleting a note', () => {
  it('removes it from Franki and the Anki collection, cards and all', async () => {
    const { store, anki } = await franki();
    const victim = [...store.notes.values()].find((n) => n.fields.Front === 'Capital of Bolivia?')!;
    await deleteNote(store, victim.id, NOW);
    expect(await store.getNote(victim.id)).toBeUndefined();
    expect([...store.cards.values()].some((c) => c.noteId === victim.id)).toBe(false);
    const db = await anki();
    expect(await db.first('SELECT id FROM notes WHERE id = ?', Number(victim.id))).toBeNull();
    expect((await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM graves WHERE oid = ? AND type = 1', Number(victim.id)))!.n).toBe(1);
    db.close();
  });
});
