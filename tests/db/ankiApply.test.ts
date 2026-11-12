import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { buildExport } from '../../src/anki/collection';
import {
  ankiCollectionPlan, CARD_COLUMNS, CARD_RETIRE_SQL, CARD_ROWS_SQL, CARD_UPSERT_SQL, cardValues, NOTE_COLUMNS, NOTE_ROWS_SQL,
  NOTE_UPSERT_SQL, noteValues, rowValues,
} from '../../src/db/ankiApply';
import type { Card, Note } from '../../src/core/types';
import { importAnkiJson } from '../../src/import/ankiJson';
import { readCollectionRows } from '../support/ankiRows';
import { NOW } from '../support/fixtures';

const FIXTURE = join(__dirname, '..', 'fixtures', 'anki', 'collection.anki2');

/** Franki's notes and cards tables as sqliteRepo makes them: the CREATE TABLE, then each migration's column. */
function frankiTables() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE notes (id TEXT PRIMARY KEY, deck TEXT NOT NULL, model TEXT NOT NULL, fields TEXT NOT NULL, tags TEXT NOT NULL);
    CREATE TABLE cards (id TEXT PRIMARY KEY, note_id TEXT NOT NULL, kind TEXT NOT NULL, suspended INTEGER NOT NULL DEFAULT 0,
      sched TEXT NOT NULL, state INTEGER NOT NULL, due TEXT NOT NULL);
    ALTER TABLE cards ADD COLUMN retired INTEGER NOT NULL DEFAULT 0; ALTER TABLE cards ADD COLUMN anki_id TEXT;
    ALTER TABLE cards ADD COLUMN buried_at TEXT; ALTER TABLE cards ADD COLUMN deck TEXT; ALTER TABLE cards ADD COLUMN filtered_deck TEXT;
    ALTER TABLE cards ADD COLUMN position INTEGER; ALTER TABLE cards ADD COLUMN anki_mod INTEGER; ALTER TABLE cards ADD COLUMN filtered_due INTEGER;
    ALTER TABLE cards ADD COLUMN preview_due TEXT; ALTER TABLE cards ADD COLUMN flag INTEGER;`);
  return db;
}

/** What applyAnkiCollection did before: every row rewritten, and the retire done in SQL. */
function rewriteAll(db: DatabaseSync, notes: Note[], cards: Card[]) {
  for (const n of notes) db.prepare(NOTE_UPSERT_SQL).run(...noteValues(n));
  const incoming = new Set(cards.map((c) => c.id));
  for (const r of db.prepare('SELECT id FROM cards WHERE anki_id IS NOT NULL').all() as { id: string }[]) {
    if (!incoming.has(r.id)) db.prepare(CARD_RETIRE_SQL).run(r.id);
  }
  for (const c of cards) db.prepare(CARD_UPSERT_SQL).run(...cardValues(c));
}

/** What it does now: the plan, from the stored rows. */
function applyPlan(db: DatabaseSync, notes: Note[], cards: Card[]) {
  const plan = ankiCollectionPlan({
    notes: (db.prepare(NOTE_ROWS_SQL).all() as any[]).map((r) => rowValues(r, NOTE_COLUMNS)),
    cards: (db.prepare(CARD_ROWS_SQL).all() as any[]).map((r) => rowValues(r, CARD_COLUMNS)),
  }, notes, cards);
  for (const r of plan.notes) db.prepare(NOTE_UPSERT_SQL).run(...r);
  for (const id of plan.retire) db.prepare(CARD_RETIRE_SQL).run(id);
  for (const r of plan.cards) db.prepare(CARD_UPSERT_SQL).run(...r);
  return plan;
}

const dump = (db: DatabaseSync) => ({
  notes: db.prepare(`${NOTE_ROWS_SQL} ORDER BY id`).all(),
  cards: db.prepare(`${CARD_ROWS_SQL} ORDER BY id`).all(),
});

describe("taking in Anki's collection: only the rows that change", () => {
  it('leaves the tables exactly as rewriting every row does, through a first import and a refresh with changes', async () => {
    const { notes, cards } = importAnkiJson(buildExport(await readCollectionRows(FIXTURE)), { now: NOW });
    const full = frankiTables();
    const planned = frankiTables();
    // Franki's own rows (a TSV note and card) and a retired card that comes back, beside Anki's.
    for (const db of [full, planned]) {
      db.prepare(NOTE_UPSERT_SQL).run(...noteValues({ id: 'tsv:x', deck: 'TSV', model: 'Omnilanguage', fields: { Entry: 'x' }, tags: [] }));
      db.prepare(CARD_UPSERT_SQL).run(...cardValues({ ...cards[0], id: 'tsv:x:forward', noteId: 'tsv:x', ankiId: undefined }));
    }

    const first = applyPlan(planned, notes, cards);
    rewriteAll(full, notes, cards);
    expect(dump(planned)).toEqual(dump(full));
    expect([first.notes.length, first.cards.length]).toEqual([new Set(notes.map((n) => n.id)).size, new Set(cards.map((c) => c.id)).size]);

    // Taken in again unchanged: nothing to write.
    expect(applyPlan(planned, notes, cards)).toEqual({ notes: [], cards: [], retire: [] });

    // Anki changed things: a card answered, a note edited, a card flagged, one card gone.
    const [answered, flagged, gone] = cards;
    const changedCards = cards.filter((c) => c.id !== gone.id).map((c) =>
      c.id === answered.id ? { ...c, sched: { ...c.sched, reps: c.sched.reps + 1, due: '2026-11-20T12:00:00.000Z' } }
        : c.id === flagged.id ? { ...c, flag: 2 } : c);
    const changedNotes = notes.map((n, i) => (i === 0 ? { ...n, tags: [...n.tags, 'edited'] } : n));
    const refresh = applyPlan(planned, changedNotes, changedCards);
    rewriteAll(full, changedNotes, changedCards);
    expect(dump(planned)).toEqual(dump(full));
    expect(refresh.notes).toHaveLength(1);
    expect(refresh.cards.map((r) => r[0]).sort()).toEqual([answered.id, flagged.id].sort());
    expect(refresh.retire).toEqual([gone.id]);

    // The gone card comes back: written again, no longer retired.
    const back = applyPlan(planned, changedNotes, [...changedCards, gone]);
    rewriteAll(full, changedNotes, [...changedCards, gone]);
    expect(dump(planned)).toEqual(dump(full));
    expect(back.cards.map((r) => r[0])).toEqual([gone.id]);
  });

  it("keeps a new card's stored due, the time it was first taken in, so a later refresh doesn't rewrite it", async () => {
    const data = buildExport(await readCollectionRows(FIXTURE));
    const first = importAnkiJson(data, { now: NOW });
    const db = frankiTables();
    applyPlan(db, first.notes, first.cards);
    const before = dump(db);

    // A day later, unchanged in Anki: the import restamps every new card, and nothing is written.
    const later = importAnkiJson(data, { now: new Date(2026, 10, 12, 12) });
    expect(later.cards.some((c) => c.sched.state === 0 && c.sched.due !== NOW.toISOString())).toBe(true);
    expect(applyPlan(db, later.notes, later.cards)).toEqual({ notes: [], cards: [], retire: [] });
    expect(dump(db)).toEqual(before);

    // A new card changed in Anki is written, keeping its due; one studied there takes Anki's.
    const [flagged, studied] = later.cards.filter((c) => c.sched.state === 0);
    const changed = later.cards.map((c) => (c.id === flagged.id ? { ...c, flag: 1 }
      : c.id === studied.id ? { ...c, sched: { ...c.sched, state: 2, due: '2026-11-20T12:00:00.000Z' } } : c));
    applyPlan(db, later.notes, changed);
    const row = (id: string) => db.prepare('SELECT flag, state, due FROM cards WHERE id = ?').get(id) as any;
    expect(row(flagged.id)).toEqual({ flag: 1, state: 0, due: NOW.toISOString() });
    expect(row(studied.id)).toEqual({ flag: 0, state: 2, due: '2026-11-20T12:00:00.000Z' });
    expect(JSON.parse((db.prepare('SELECT sched FROM cards WHERE id = ?').get(flagged.id) as any).sched).due).toBe(NOW.toISOString());
  });
});
