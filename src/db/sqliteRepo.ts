import * as SQLite from 'expo-sqlite';
import { studyDayStart } from '../core/day';
import type { Card, DeckParams, Note, ReviewLogEntry } from '../core/types';
import type { Repo } from './repo';

const SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY, deck TEXT NOT NULL, model TEXT NOT NULL, fields TEXT NOT NULL, tags TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY, note_id TEXT NOT NULL, kind TEXT NOT NULL, suspended INTEGER NOT NULL DEFAULT 0,
  sched TEXT NOT NULL, state INTEGER NOT NULL, due TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cards_due ON cards(state, due);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT, card_id TEXT NOT NULL, rating INTEGER NOT NULL,
  reviewed_at TEXT NOT NULL, state INTEGER NOT NULL, due TEXT NOT NULL, stability REAL NOT NULL, difficulty REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS deck_params (deck TEXT PRIMARY KEY, params TEXT NOT NULL);
`;

/**
 * Columns added after a table first shipped. Append here; never edit the CREATE TABLE above,
 * which only runs on a fresh install, so a column added there never reaches an existing one.
 *
 * Each entry is skipped when its column already exists, judged by reading the table's real
 * columns (`PRAGMA table_info`). A `user_version` counter was the alternative and is
 * deliberately not used: it has to be kept in step with the schema by hand, and anything that
 * drops and recreates tables without resetting it skips migrations on a schema that lacks them.
 */
const MIGRATIONS: { table: string; column: string; sql: string }[] = [
  { table: 'cards', column: 'retired', sql: 'ALTER TABLE cards ADD COLUMN retired INTEGER NOT NULL DEFAULT 0' },
];

async function migrate(db: SQLite.SQLiteDatabase) {
  const columns = new Map<string, Set<string>>();
  for (const m of MIGRATIONS) {
    if (!columns.has(m.table)) {
      const rows = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${m.table})`);
      columns.set(m.table, new Set(rows.map((r) => r.name)));
    }
    const have = columns.get(m.table)!;
    if (have.has(m.column)) continue;
    await db.execAsync(m.sql);
    have.add(m.column);
  }
}

export async function openRepo(name = 'flashcards.db'): Promise<Repo> {
  const db = await SQLite.openDatabaseAsync(name);
  await db.execAsync(SCHEMA);
  await migrate(db);

  const rowToCard = (r: any): Card => ({
    id: r.id, noteId: r.note_id, kind: r.kind, suspended: !!r.suspended, retired: !!r.retired, sched: JSON.parse(r.sched),
  });
  const rowToNote = (r: any): Note => ({
    id: r.id, deck: r.deck, model: r.model, fields: JSON.parse(r.fields), tags: JSON.parse(r.tags),
  });

  return {
    async upsertNotesAndCards(notes, cards) {
      await db.withTransactionAsync(async () => {
        for (const n of notes) {
          await db.runAsync(
            'INSERT OR REPLACE INTO notes (id, deck, model, fields, tags) VALUES (?, ?, ?, ?, ?)',
            n.id, n.deck, n.model, JSON.stringify(n.fields), JSON.stringify(n.tags),
          );
        }
        // Retire the cards a note no longer generates (a Generate* field turned off in Anki).
        const idsByNote = new Map<string, string[]>(notes.map((n) => [n.id, []]));
        for (const c of cards) idsByNote.get(c.noteId)?.push(c.id);
        for (const [noteId, ids] of idsByNote) {
          await db.runAsync(
            `UPDATE cards SET retired = 1 WHERE note_id = ? AND id NOT IN (${ids.map(() => '?').join(', ')})`,
            noteId, ...ids,
          );
        }
        for (const c of cards) {
          // Re-importing the same note must not wipe existing review progress: scheduling and
          // suspension are overwritten only on a card still New. Every card here is generated
          // again, so it is never retired.
          await db.runAsync(
            'INSERT INTO cards (id, note_id, kind, suspended, retired, sched, state, due) VALUES (?, ?, ?, ?, 0, ?, ?, ?) ' +
              'ON CONFLICT(id) DO UPDATE SET retired = 0, ' +
              'suspended = CASE WHEN cards.state = 0 THEN excluded.suspended ELSE cards.suspended END, ' +
              'sched = CASE WHEN cards.state = 0 THEN excluded.sched ELSE cards.sched END, ' +
              'due = CASE WHEN cards.state = 0 THEN excluded.due ELSE cards.due END, ' +
              'state = CASE WHEN cards.state = 0 THEN excluded.state ELSE cards.state END',
            c.id, c.noteId, c.kind, c.suspended ? 1 : 0, JSON.stringify(c.sched), c.sched.state, c.sched.due,
          );
        }
      });
    },
    async listNotes() {
      return (await db.getAllAsync('SELECT * FROM notes')).map(rowToNote);
    },
    async getNote(id) {
      const r = await db.getFirstAsync('SELECT * FROM notes WHERE id = ?', id);
      return r ? rowToNote(r) : undefined;
    },
    async listCards(deck) {
      const rows = deck
        ? await db.getAllAsync('SELECT c.* FROM cards c JOIN notes n ON n.id = c.note_id WHERE n.deck = ?', deck)
        : await db.getAllAsync('SELECT * FROM cards');
      return rows.map(rowToCard);
    },
    async saveCard(c) {
      await db.runAsync(
        'UPDATE cards SET suspended = ?, retired = ?, sched = ?, state = ?, due = ? WHERE id = ?',
        c.suspended ? 1 : 0, c.retired ? 1 : 0, JSON.stringify(c.sched), c.sched.state, c.sched.due, c.id,
      );
    },
    async addReview(e: ReviewLogEntry) {
      await db.runAsync(
        'INSERT INTO reviews (card_id, rating, reviewed_at, state, due, stability, difficulty) VALUES (?, ?, ?, ?, ?, ?, ?)',
        e.cardId, e.rating, e.reviewedAt, e.state, e.due, e.stability, e.difficulty,
      );
    },
    async newIntroducedToday(deck, now, dayStartsAtHour) {
      // ISO strings are all UTC, so comparing them as text compares the instants.
      const start = studyDayStart(now, dayStartsAtHour);
      const r = await db.getFirstAsync<{ n: number }>(
        'SELECT COUNT(DISTINCT r.card_id) AS n FROM reviews r JOIN cards c ON c.id = r.card_id ' +
          'JOIN notes n ON n.id = c.note_id WHERE n.deck = ? AND r.state = 0 AND r.reviewed_at >= ?',
        deck, start.toISOString(),
      );
      return r?.n ?? 0;
    },
    async saveDeckParams(params) {
      await db.withTransactionAsync(async () => {
        for (const [deck, p] of params) {
          await db.runAsync('INSERT OR REPLACE INTO deck_params (deck, params) VALUES (?, ?)', deck, JSON.stringify(p));
        }
      });
    },
    async listDeckParams() {
      const rows = await db.getAllAsync<{ deck: string; params: string }>('SELECT * FROM deck_params');
      return new Map(rows.map((r) => [r.deck, JSON.parse(r.params) as DeckParams]));
    },
  };
}
