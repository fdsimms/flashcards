import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildExport } from '../../src/anki/collection';
import { studiedOn } from '../../src/anki/deckStats';
import { countMovable, historyRevlog, moveToAnki } from '../../src/anki/moveToAnki';
import type { NoteStore } from '../../src/anki/noteService';
import { ankiDayNumber } from '../../src/anki/writeback';
import { makeCards } from '../../src/core/cards';
import { paramsForDeck, review } from '../../src/core/scheduler';
import type { Card, Note } from '../../src/core/types';
import { MemoryRepo } from '../../src/db/repo';
import { importAnkiJson } from '../../src/import/ankiJson';
import { reconcileIds } from '../../src/import/reconcile';
import { readCollectionRows } from '../support/ankiRows';
import { nodeSyncDb } from '../support/syncDb';

const FIXTURE = join(__dirname, '..', 'fixtures', 'anki', 'collection.anki2');
const TRIVIA = '🧠 Trivia';
const NOW = new Date(2026, 10, 20, 12);

async function franki() {
  const dir = mkdtempSync(join(tmpdir(), 'move-'));
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
    keptCollection: async () => ({}),
    lockAnki: <T,>(fn: () => Promise<T>) => fn(),
    withSyncConnection: async <T,>(fn: (db: Awaited<ReturnType<typeof nodeSyncDb>>) => Promise<T>) => {
      const db = await nodeSyncDb(kept, { unicase: true });
      try { return await fn(db); } finally { db.close(); }
    },
  }) as NoteStore & MemoryRepo;
  return { store, kept, readIn };
}

/** A note of Franki's own, answered at each of `answers` with its rating, as Review answers one. */
async function frankiNote(store: MemoryRepo, note: Note, answers: [Date, 1 | 2 | 3 | 4][] = []): Promise<Card> {
  const noteType = (await store.listNoteTypes()).get(note.model);
  let card = { ...makeCards(note, new Date(2026, 10, 1), noteType)[0], position: 500 };
  const params = paramsForDeck(note.deck, await store.listDeckParams());
  for (const [at, rating] of answers) {
    const r = review(card.sched, rating, at, params, { dayStartsAtHour: 4 });
    await store.addReview({ ...r.log, cardId: card.id });
    card = { ...card, sched: r.sched };
  }
  await store.upsertNotesAndCards([note], [card]);
  return card;
}

const fiji: Note = { id: 'tsv:🧠 Trivia:Capital of Fiji?', deck: TRIVIA, model: 'Basic', fields: { Front: 'Capital of Fiji?', Back: 'Suva' }, tags: ['oceania'] };
const ANSWERS: [Date, 1 | 2 | 3 | 4][] = [[new Date(2026, 10, 18, 10), 1], [new Date(2026, 10, 18, 10, 10), 3], [new Date(2026, 10, 18, 10, 30), 3], [new Date(2026, 10, 20, 9), 3]];

describe('moving words that are only in Franki into the Anki collection', () => {
  it('adds the note with its schedule and its answers, and Franki keeps the same note and card', async () => {
    const { store, kept, readIn } = await franki();
    const card = await frankiNote(store, fiji, ANSWERS);
    const peru: Note = { id: 'tsv:🧠 Trivia:Capital of Peru?', deck: TRIVIA, model: 'Basic', fields: { Front: 'Capital of Peru?', Back: 'Lima' }, tags: [] };
    await frankiNote(store, peru);
    const omni: Note = { id: 'tsv:🧠 Trivia:kot', deck: TRIVIA, model: 'Omnilanguage', fields: { Entry: 'kot', Meaning: 'cat' }, tags: [] };
    await frankiNote(store, omni);

    expect(await countMovable(store)).toBe(1);
    const result = await moveToAnki(store, readIn, NOW);
    expect(result.moved).toBe(1);
    expect(result.left).toEqual([
      { word: 'Capital of Peru?', reason: 'Anki already has a note with this Front' },
      { word: 'kot', reason: 'the Anki collection has no note type called "Omnilanguage"' },
    ]);

    const db = await nodeSyncDb(kept, { unicase: true });
    const note = (await db.first<{ id: number; tags: string; flds: string }>("SELECT id, tags, flds FROM notes WHERE flds LIKE 'Capital of Fiji?%'"))!;
    expect(note.flds).toBe('Capital of Fiji?\x1fSuva');
    expect(note.tags).toBe(' oceania ');
    const row = (await db.first<any>('SELECT id, did, type, queue, due, ivl, reps, lapses, data FROM cards WHERE nid = ?', note.id))!;
    const crt = (await db.first<{ crt: number }>('SELECT crt FROM col'))!.crt;
    const clock = { crt, dayStartsAtHour: 4 };
    expect(row).toMatchObject({ type: 2, queue: 2, ivl: card.sched.scheduledDays, reps: card.sched.reps, lapses: card.sched.lapses });
    expect(row.due).toBe(ankiDayNumber(Math.floor(Date.parse(card.sched.due) / 1000), clock));
    expect(JSON.parse(row.data)).toMatchObject({ s: Number(card.sched.stability.toFixed(4)), d: Number(card.sched.difficulty.toFixed(3)), lrt: Math.floor(ANSWERS[3][0].getTime() / 1000) });
    const revlog = await db.all<any>('SELECT id, ease, type, lastIvl, usn FROM revlog WHERE cid = ? ORDER BY id', row.id);
    // Each answer at its own time: what Anki's FSRS reads from history, and what keeps Stats from counting it twice.
    expect(revlog.map((r) => r.id)).toEqual(ANSWERS.map(([at]) => at.getTime()));
    expect(revlog.map((r) => r.ease)).toEqual([1, 3, 3, 3]);
    expect(revlog[0]).toMatchObject({ type: 0, lastIvl: 0, usn: -1 });
    expect(revlog[3].type).toBe(1);
    // Today's answer counts toward Trivia's limits, as an answer in Anki would.
    const trivia = (await db.first<{ common: Uint8Array }>('SELECT common FROM decks WHERE id = ?', row.did))!;
    expect(studiedOn(trivia.common, ankiDayNumber(Math.floor(NOW.getTime() / 1000), clock)).review).toBe(1);
    db.close();

    // Read back in: the same note and card, now Anki's, with its schedule on the same day.
    const notes = (await store.listNotes()).filter((n) => n.fields.Front === 'Capital of Fiji?');
    expect(notes.map((n) => n.id)).toEqual([fiji.id]);
    const after = (await store.listCards()).find((c) => c.id === card.id)!;
    expect(after.ankiId).toBe(String(row.id));
    expect(after.sched.state).toBe(2);
    expect(new Date(after.sched.due).toDateString()).toBe(new Date(card.sched.due).toDateString());
    expect(await countMovable(store)).toBe(0);
  });

  it('keeps a new word in its place among the new cards', async () => {
    const { store, kept, readIn } = await franki();
    await frankiNote(store, fiji);
    await moveToAnki(store, readIn, NOW);
    const db = await nodeSyncDb(kept, { unicase: true });
    const row = (await db.first<{ type: number; queue: number; due: number }>("SELECT c.type, c.queue, c.due FROM cards c JOIN notes n ON n.id = c.nid WHERE n.flds LIKE 'Capital of Fiji?%'"))!;
    // The collection's next position (the fixture's nextPos is 8).
    expect(row).toEqual({ type: 0, queue: 0, due: 8 });
    db.close();
  });
});

describe('a retired card', () => {
  it('stays retired, and in Franki only', async () => {
    const { store, readIn } = await franki();
    const card = await frankiNote(store, fiji);
    const retired = { ...card, id: `${fiji.id}:t1`, kind: 't1', retired: true } as Card;
    await store.saveCard(retired);
    expect((await moveToAnki(store, readIn, NOW)).moved).toBe(1);
    const after = (await store.listCards()).find((c) => c.id === retired.id)!;
    expect(after.retired).toBe(true);
    expect(after.ankiId).toBeUndefined();
  });
});

describe('historyRevlog', () => {
  const clock = { crt: Math.floor(new Date(2026, 9, 1, 4).getTime() / 1000), dayStartsAtHour: 4 };
  it('ends a card that is new again with the reset row Forget writes', () => {
    const card = { id: 'x', noteId: 'n', kind: 't0', suspended: false, retired: false, sched: { due: NOW.toISOString(), stability: 0, difficulty: 0, elapsedDays: 0, scheduledDays: 0, learningSteps: 0, reps: 1, lapses: 0, state: 0, lastReview: null } } as Card;
    const rows = historyRevlog(card, [{ cardId: 'x', rating: 3, reviewedAt: new Date(2026, 10, 1, 10).toISOString(), state: 0, due: new Date(2026, 10, 1, 10, 10).toISOString(), stability: 0, difficulty: 0 }], clock);
    expect(rows.map((r) => [r.ease, r.type])).toEqual([[3, 0], [0, 4]]);
    expect(rows[1]).toMatchObject({ ivl: 0, factor: 0, lastIvl: rows[0].ivl });
  });
});
