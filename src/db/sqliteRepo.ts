import * as SQLite from 'expo-sqlite';
import type { Card, Note, ReviewLogEntry } from '../core/types';
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
`;

export async function openRepo(name = 'flashcards.db'): Promise<Repo> {
  const db = await SQLite.openDatabaseAsync(name);
  await db.execAsync(SCHEMA);

  const rowToCard = (r: any): Card => ({
    id: r.id, noteId: r.note_id, kind: r.kind, suspended: !!r.suspended, sched: JSON.parse(r.sched),
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
        for (const c of cards) {
          // Re-importing the same note must not wipe existing review progress.
          await db.runAsync(
            'INSERT INTO cards (id, note_id, kind, suspended, sched, state, due) VALUES (?, ?, ?, ?, ?, ?, ?) ' +
              'ON CONFLICT(id) DO UPDATE SET suspended = excluded.suspended, sched = excluded.sched, ' +
              'state = excluded.state, due = excluded.due WHERE cards.state = 0',
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
        'UPDATE cards SET suspended = ?, sched = ?, state = ?, due = ? WHERE id = ?',
        c.suspended ? 1 : 0, JSON.stringify(c.sched), c.sched.state, c.sched.due, c.id,
      );
    },
    async addReview(e: ReviewLogEntry) {
      await db.runAsync(
        'INSERT INTO reviews (card_id, rating, reviewed_at, state, due, stability, difficulty) VALUES (?, ?, ?, ?, ?, ?, ?)',
        e.cardId, e.rating, e.reviewedAt, e.state, e.due, e.stability, e.difficulty,
      );
    },
    async newIntroducedToday(deck, now) {
      const start = new Date(now); start.setHours(0, 0, 0, 0);
      const r = await db.getFirstAsync<{ n: number }>(
        'SELECT COUNT(DISTINCT r.card_id) AS n FROM reviews r JOIN cards c ON c.id = r.card_id ' +
          'JOIN notes n ON n.id = c.note_id WHERE n.deck = ? AND r.state = 0 AND r.reviewed_at >= ?',
        deck, start.toISOString(),
      );
      return r?.n ?? 0;
    },
  };
}
