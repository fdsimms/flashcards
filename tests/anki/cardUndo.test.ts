import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { setCardStatesUndoable, undoCardAction } from '../../src/anki/cardUndo';
import { buildExport } from '../../src/anki/collection';
import type { NoteStore } from '../../src/anki/noteService';
import { forgetCards, setDueDates } from '../../src/anki/rescheduleService';
import { parseDueDate } from '../../src/core/reschedule';
import type { CardAction } from '../../src/core/session';
import type { Card } from '../../src/core/types';
import { MemoryRepo } from '../../src/db/repo';
import { importAnkiJson } from '../../src/import/ankiJson';
import { readCollectionRows } from '../support/ankiRows';
import { nodeSyncDb } from '../support/syncDb';

const FIXTURE = join(__dirname, '..', 'fixtures', 'anki', 'collection.anki2');
const NOW = new Date(2026, 10, 11, 12);
const LATER = new Date(2026, 10, 11, 12, 5);
const H = 4;
const REVIEW = '1794408858014';
const SUSPENDED = '1794408858019';

/** Franki after importing the fixture, with the kept collection beside it (as rescheduleService.test.ts). */
async function franki(opts: { kept?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'undo-'));
  const kept = join(dir, 'collection.anki2');
  copyFileSync(FIXTURE, kept);
  const repo = new MemoryRepo();
  const data = importAnkiJson(buildExport(await readCollectionRows(kept)), { now: NOW });
  await repo.saveNoteTypes(data.noteTypes ?? []);
  await repo.applyAnkiCollection(data.notes, data.cards);
  if (data.collectionSettings) await repo.saveCollectionSettings(data.collectionSettings);
  const store = Object.assign(repo, {
    keptCollection: async () => (opts.kept === false ? null : {}),
    lockAnki: <T,>(fn: () => Promise<T>) => fn(),
    withSyncConnection: async <T,>(fn: (db: Awaited<ReturnType<typeof nodeSyncDb>>) => Promise<T>) => {
      const db = await nodeSyncDb(kept);
      try { return await fn(db); } finally { db.close(); }
    },
  }) as NoteStore & MemoryRepo;
  const sql = <T,>(q: string, ...p: (string | number)[]) => {
    const db = new DatabaseSync(kept);
    try { return db.prepare(q).all(...p) as T[]; } finally { db.close(); }
  };
  const byAnkiId = async (id: string) => (await repo.listCards()).find((c) => c.ankiId === id)!;
  return { store, sql, byAnkiId };
}

type Sql = Awaited<ReturnType<typeof franki>>['sql'];
const cardRow = (sql: Sql, id: string) => sql('SELECT * FROM cards WHERE id = ?', Number(id))[0];
const action = (kind: CardAction['kind'], before: Card[], anki: CardAction['anki']): CardAction => ({ kind, label: 'x', before, anki, afterAnswers: 0 });

describe('undo of a bury, suspend or flag', () => {
  it('puts the card back as it was, in Franki and in the kept collection, mod and usn included', async () => {
    const { store, sql, byAnkiId } = await franki();
    const card = await byAnkiId(REVIEW);
    const rowBefore = cardRow(sql, REVIEW);
    const { cards: [after], anki } = await setCardStatesUndoable(store, [card], (s) => ({ ...s, suspended: true, flag: 3 }), NOW, H);
    expect(after).toMatchObject({ suspended: true, flag: 3 });
    expect(cardRow(sql, REVIEW)).toMatchObject({ queue: -1, usn: -1 });
    const restored = await undoCardAction(store, action('state', [card], anki), [after], LATER);
    expect(restored?.[0]).toMatchObject({ suspended: card.suspended, flag: card.flag });
    expect(await byAnkiId(REVIEW)).toEqual(card);
    expect(cardRow(sql, REVIEW)).toEqual(rowBefore);
  });

  it('is refused, changing nothing, once a sync has sent it', async () => {
    const { store, sql, byAnkiId } = await franki();
    const card = await byAnkiId(REVIEW);
    const { cards: [after], anki } = await setCardStatesUndoable(store, [card], (s) => ({ ...s, buried: true }), NOW, H);
    // What a sync does to a row it sent.
    sql('UPDATE cards SET usn = 12 WHERE id = ?', Number(REVIEW));
    expect(await undoCardAction(store, action('state', [card], anki), [after], LATER)).toBeNull();
    expect(await byAnkiId(REVIEW)).toEqual(after);
    expect(cardRow(sql, REVIEW)).toMatchObject({ queue: -3, usn: 12 });
  });

  it('puts back a Franki-only card with no collection to write', async () => {
    const { store, byAnkiId } = await franki({ kept: false });
    const card = await byAnkiId(REVIEW);
    const { cards: [after], anki } = await setCardStatesUndoable(store, [card], (s) => ({ ...s, suspended: true }), NOW, H);
    expect(anki).toBeUndefined();
    await undoCardAction(store, action('state', [card], anki), [after], LATER);
    expect((await byAnkiId(REVIEW)).suspended).toBe(card.suspended);
  });
});

describe('undo of Forget and Set Due Date', () => {
  it("takes Forget back: the card's row, its Manual review log row and the collection's next position", async () => {
    const { store, sql, byAnkiId } = await franki();
    const card = await byAnkiId(REVIEW);
    const rowBefore = cardRow(sql, REVIEW);
    const revlogBefore = sql('SELECT * FROM revlog ORDER BY id');
    const configBefore = sql("SELECT * FROM config WHERE KEY = 'nextPos'");
    const { cards: [after], anki } = await forgetCards(store, [card], { resetCounts: true }, NOW);
    expect(after.sched.state).toBe(0);
    expect(anki?.revlogIds).toHaveLength(1);
    expect(await undoCardAction(store, action('schedule', [card], anki), [after], LATER)).not.toBeNull();
    expect(await byAnkiId(REVIEW)).toEqual(card);
    expect(cardRow(sql, REVIEW)).toEqual(rowBefore);
    expect(sql('SELECT * FROM revlog ORDER BY id')).toEqual(revlogBefore);
    expect(sql("SELECT * FROM config WHERE KEY = 'nextPos'")).toEqual(configBefore);
  });

  it('takes Set Due Date back, out of the suspension it lifted too', async () => {
    const { store, sql, byAnkiId } = await franki();
    const card = await byAnkiId(SUSPENDED);
    const rowBefore = cardRow(sql, SUSPENDED);
    const { cards: [after], anki } = await setDueDates(store, [card], parseDueDate('3')!, NOW);
    expect(after.suspended).toBe(false);
    await undoCardAction(store, action('schedule', [card], anki), [after], LATER);
    expect(await byAnkiId(SUSPENDED)).toEqual(card);
    expect(cardRow(sql, SUSPENDED)).toEqual(rowBefore);
  });

  it('is refused once a sync has sent the Manual review log row', async () => {
    const { store, sql, byAnkiId } = await franki();
    const card = await byAnkiId(REVIEW);
    const { cards: [after], anki } = await setDueDates(store, [card], parseDueDate('3')!, NOW);
    sql('UPDATE revlog SET usn = 12 WHERE id = ?', anki!.revlogIds[0]);
    expect(await undoCardAction(store, action('schedule', [card], anki), [after], LATER)).toBeNull();
    expect(await byAnkiId(REVIEW)).toEqual(after);
  });
});
