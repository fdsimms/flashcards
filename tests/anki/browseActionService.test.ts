import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BulkRefused, runBulkAction, undoBulkAction } from '../../src/anki/browseActionService';
import { buildExport } from '../../src/anki/collection';
import type { NoteStore } from '../../src/anki/noteService';
import { MemoryRepo } from '../../src/db/repo';
import { importAnkiJson } from '../../src/import/ankiJson';
import { reconcileIds } from '../../src/import/reconcile';
import { readCollectionRows } from '../support/ankiRows';
import { nodeSyncDb } from '../support/syncDb';

const FIXTURE = join(__dirname, '..', 'fixtures', 'anki', 'collection.anki2');
const NOW = new Date(2026, 10, 20, 12);
const ctx = { now: NOW, dayStartsAtHour: 4 };

async function franki() {
  const dir = mkdtempSync(join(tmpdir(), 'bulksvc-'));
  const kept = join(dir, 'collection.anki2');
  copyFileSync(FIXTURE, kept);
  const repo = new MemoryRepo();
  const data = reconcileIds(importAnkiJson(buildExport(await readCollectionRows(kept)), { now: NOW }), [], []);
  await repo.saveNoteTypes(data.noteTypes ?? []);
  await repo.applyAnkiCollection(data.notes, data.cards);
  if (data.collectionSettings) await repo.saveCollectionSettings(data.collectionSettings);
  const store = Object.assign(repo, {
    keptCollection: async () => ({}),
    lockAnki: <T,>(fn: () => Promise<T>) => fn(),
    withSyncConnection: async <T,>(fn: (db: Awaited<ReturnType<typeof nodeSyncDb>>) => Promise<T>) => {
      const db = await nodeSyncDb(kept, { unicase: true });
      try { return await fn(db); } finally { db.close(); }
    },
  }) as NoteStore & MemoryRepo;
  const row = async (sql: string, ...args: (string | number | null)[]) => { const db = await nodeSyncDb(kept, { unicase: true }); try { return await db.first<any>(sql, ...args); } finally { db.close(); } };
  return { store, row };
}

const THAI_NOTE = '1794408858013'; // two review cards
const PERU = '1794408858016';

describe("Browse's actions on the notes picked", () => {
  it('suspends every card of the notes, in Franki and Anki, and undoes it', async () => {
    const { store, row } = await franki();
    const r = await runBulkAction(store, [THAI_NOTE], { kind: 'suspend' }, ctx);
    expect(r.summary).toBe('Suspended 2 cards in 1 note.');
    expect((await store.listCards()).filter((c) => c.noteId === THAI_NOTE).every((c) => c.suspended)).toBe(true);
    expect((await row('SELECT queue FROM cards WHERE id = 1794408858014')).queue).toBe(-1);
    expect(await undoBulkAction(store, r.undo, NOW)).toBe(true);
    expect((await store.listCards()).filter((c) => c.noteId === THAI_NOTE).some((c) => c.suspended)).toBe(false);
    expect((await row('SELECT queue FROM cards WHERE id = 1794408858014')).queue).toBe(2);
  });

  it('tags notes and moves them, and undoes each', async () => {
    const { store, row } = await franki();
    const tagged = await runBulkAction(store, [THAI_NOTE, PERU], { kind: 'addTags', tags: ['travel'] }, ctx);
    expect(tagged.summary).toBe('Tagged 2 notes travel.');
    expect((await store.getNote(PERU))!.tags).toEqual(['travel']);
    expect((await row('SELECT tags FROM notes WHERE id = ?', Number(PERU))).tags).toBe(' travel ');
    await undoBulkAction(store, tagged.undo, NOW);
    expect((await store.getNote(PERU))!.tags).toEqual([]);

    const moved = await runBulkAction(store, [THAI_NOTE], { kind: 'deck', deck: '🧠 Trivia' }, ctx);
    expect(moved.summary).toBe('Moved 1 note to 🧠 Trivia.');
    expect((await store.getNote(THAI_NOTE))!.deck).toBe('🧠 Trivia');
    expect((await row('SELECT did FROM cards WHERE id = 1794408858014')).did).toBe(1794408857991);
    await undoBulkAction(store, moved.undo, NOW);
    expect((await store.getNote(THAI_NOTE))!.deck).toBe('👅 Languages::🐘 ภาษาไทย');
    expect((await row('SELECT did FROM cards WHERE id = 1794408858014')).did).toBe(1794408857990);
  });

  it('says when a change of deck or tags changes nothing', async () => {
    const { store } = await franki();
    expect((await runBulkAction(store, [PERU], { kind: 'removeTags', tags: ['nope'] }, ctx)).summary).toBe('None of these notes has those tags.');
  });

  it('repositions new cards only, and refuses notes with none', async () => {
    const { store, row } = await franki();
    await expect(runBulkAction(store, [THAI_NOTE], { kind: 'reposition', start: 1, step: 1, randomize: false, shift: false }, ctx)).rejects.toBeInstanceOf(BulkRefused);
    const r = await runBulkAction(store, ['1794408858018', '1794408858030'], { kind: 'reposition', start: 100, step: 5, randomize: false, shift: false }, ctx);
    expect(r.summary).toBe('Repositioned 2 new cards.');
    expect((await row('SELECT due FROM cards WHERE id = 1794408858030')).due).toBe(105);
    expect((await store.listCards()).find((c) => c.ankiId === '1794408858030')!.position).toBe(105);
    await undoBulkAction(store, r.undo, NOW);
    expect((await row('SELECT due FROM cards WHERE id = 1794408858030')).due).toBe(6);
    expect((await store.listCards()).find((c) => c.ankiId === '1794408858030')!.position).toBe(6);
  });

  it('sets due dates and forgets, as Review does', async () => {
    const { store } = await franki();
    const due = await runBulkAction(store, [THAI_NOTE], { kind: 'dueDate', spec: { min: 3, max: 3, forceReset: false } }, ctx);
    expect(due.summary).toBe('Set the due date of 2 cards in 1 note.');
    const forgot = await runBulkAction(store, [THAI_NOTE], { kind: 'forget', resetCounts: true }, ctx);
    expect(forgot.summary).toBe('Forgot 2 cards in 1 note.');
    expect((await store.listCards()).filter((c) => c.noteId === THAI_NOTE).every((c) => c.sched.state === 0)).toBe(true);
    await undoBulkAction(store, forgot.undo, NOW);
    expect((await store.listCards()).filter((c) => c.noteId === THAI_NOTE).every((c) => c.sched.state === 2)).toBe(true);
  });
});
