import * as SQLite from 'expo-sqlite';
import { studyDayStart } from '../core/day';
import type { Card, DeckParams, DeckSettings, Note, NoteType, ReviewLogEntry } from '../core/types';
import { clearMedia, listMedia, writeMedia } from '../media/mediaFiles';
import { restorePlan, sqliteFileKind } from './backup';
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
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS note_types (name TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS deck_settings (deck TEXT PRIMARY KEY, data TEXT NOT NULL);
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

/**
 * Backup, restore and reading an export bundle, which only the SQLite repo can do: they work on
 * database files, and carry the media folder in and out with them.
 */
export interface BackupStore {
  /** Writes a consistent copy of the whole database, media included, to `path` (a file path, not a URI). */
  backupTo(path: string): Promise<{ media: number }>;
  /** Replaces everything here, media included, with the backup at `path`. Throws `NotABackupError` for another kind of file. */
  restoreFrom(path: string): Promise<{ notes: number; cards: number; media: number }>;
  /** What the SQLite file at `path` is: an Anki export bundle, one of our backups, or neither. */
  sqliteFileKind(path: string): Promise<'export' | 'backup' | 'other'>;
  /** An export bundle's JSON, after writing its media files into the media folder. */
  readExportBundle(path: string): Promise<{ json: string; media: number }>;
  /** When `backupTo` last succeeded (ISO), or null. Kept outside what a restore replaces. */
  lastBackupAt(): Promise<string | null>;
}

export async function openRepo(name = 'flashcards.db'): Promise<Repo & BackupStore> {
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
      // The deck and its subdecks: "A" takes "A" and "A::...", not "AB".
      const rows = deck
        ? await db.getAllAsync(
            'SELECT c.* FROM cards c JOIN notes n ON n.id = c.note_id WHERE n.deck = ? OR substr(n.deck, 1, ?) = ?',
            deck, deck.length + 2, `${deck}::`,
          )
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
      const r = await db.runAsync(
        'INSERT INTO reviews (card_id, rating, reviewed_at, state, due, stability, difficulty) VALUES (?, ?, ?, ?, ?, ?, ?)',
        e.cardId, e.rating, e.reviewedAt, e.state, e.due, e.stability, e.difficulty,
      );
      return r.lastInsertRowId;
    },
    async deleteReview(id) {
      await db.runAsync('DELETE FROM reviews WHERE id = ?', id);
    },
    async studiedToday(now, dayStartsAtHour) {
      // ISO strings are all UTC, so comparing them as text compares the instants.
      const start = studyDayStart(now, dayStartsAtHour);
      const rows = await db.getAllAsync<{ deck: string; introduced: number; reviewed: number }>(
        'SELECT n.deck AS deck, COUNT(DISTINCT CASE WHEN r.state = 0 THEN r.card_id END) AS introduced, ' +
          'SUM(CASE WHEN r.state = 2 THEN 1 ELSE 0 END) AS reviewed ' +
          'FROM reviews r JOIN cards c ON c.id = r.card_id JOIN notes n ON n.id = c.note_id ' +
          'WHERE r.reviewed_at >= ? AND r.state IN (0, 2) GROUP BY n.deck',
        start.toISOString(),
      );
      return new Map(rows.map((r) => [r.deck, { introduced: r.introduced, reviewed: r.reviewed }]));
    },
    async saveDeckParams(params) {
      await db.withTransactionAsync(async () => {
        for (const [deck, p] of params) {
          await db.runAsync('INSERT OR REPLACE INTO deck_params (deck, params) VALUES (?, ?)', deck, JSON.stringify(p));
        }
      });
    },
    async saveNoteTypes(types) {
      await db.withTransactionAsync(async () => {
        for (const t of types) {
          await db.runAsync('INSERT OR REPLACE INTO note_types (name, data) VALUES (?, ?)', t.name, JSON.stringify(t));
        }
      });
    },
    async listNoteTypes() {
      const rows = await db.getAllAsync<{ name: string; data: string }>('SELECT * FROM note_types');
      return new Map(rows.map((r) => [r.name, JSON.parse(r.data) as NoteType]));
    },
    async listDeckSettings() {
      const rows = await db.getAllAsync<{ deck: string; data: string }>('SELECT * FROM deck_settings');
      return new Map(rows.map((r) => [r.deck, JSON.parse(r.data) as DeckSettings]));
    },
    async saveDeckSettings(deck, settings) {
      await db.runAsync('INSERT OR REPLACE INTO deck_settings (deck, data) VALUES (?, ?)', deck, JSON.stringify(settings));
    },
    async listDeckParams() {
      const rows = await db.getAllAsync<{ deck: string; params: string }>('SELECT * FROM deck_params');
      return new Map(rows.map((r) => [r.deck, JSON.parse(r.params) as DeckParams]));
    },
    async backupTo(path) {
      // VACUUM INTO writes a self-contained copy, WAL pages included, without closing anything.
      await db.runAsync('VACUUM INTO ?', path);
      // Media lives in files, not the database, so it's added to the copy as a table: a backup
      // without it would restore cards whose images and sounds are gone.
      const files = listMedia();
      await db.runAsync('ATTACH DATABASE ? AS backup', path);
      try {
        await db.execAsync('CREATE TABLE backup.media (name TEXT PRIMARY KEY, data BLOB NOT NULL)');
        for (const f of files) {
          await db.runAsync('INSERT INTO backup.media (name, data) VALUES (?, ?)', f.name, await f.bytes());
        }
      } finally {
        await db.runAsync('DETACH DATABASE backup');
      }
      await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_backup_at', ?)", new Date().toISOString());
      return { media: files.length };
    },
    async lastBackupAt() {
      const r = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'last_backup_at'");
      return r?.value ?? null;
    },
    async restoreFrom(path) {
      const columnsOf = async (schema: 'main' | 'backup') => {
        const tables = await db.getAllAsync<{ name: string }>(
          `SELECT name FROM ${schema}.sqlite_master WHERE type = 'table'`,
        );
        const out = new Map<string, string[]>();
        for (const { name } of tables) {
          const cols = await db.getAllAsync<{ name: string }>(`PRAGMA ${schema}.table_info(${JSON.stringify(name)})`);
          out.set(name, cols.map((c) => c.name));
        }
        return out;
      };
      // ATTACH can't run inside a transaction, so it brackets the one that does the work.
      let media = 0;
      await db.runAsync('ATTACH DATABASE ? AS backup', path);
      try {
        const plan = restorePlan(await columnsOf('main'), await columnsOf('backup'));
        await db.withTransactionAsync(async () => {
          for (const { table, columns } of plan) {
            await db.execAsync(`DELETE FROM main.${table}`);
            if (columns.length === 0) continue;
            const cols = columns.join(', ');
            await db.execAsync(`INSERT INTO main.${table} (${cols}) SELECT ${cols} FROM backup.${table}`);
          }
        });
        // Media after the rows, so a backup that fails to read leaves the cards and their files
        // as they were. A backup made before media was backed up has no table and keeps the files.
        const hasMedia = await db.getFirstAsync("SELECT 1 FROM backup.sqlite_master WHERE type = 'table' AND name = 'media'");
        if (hasMedia) {
          clearMedia();
          for await (const row of db.getEachAsync<{ name: string; data: Uint8Array }>('SELECT name, data FROM backup.media')) {
            await writeMedia(row.name, row.data);
            media++;
          }
        }
      } finally {
        await db.runAsync('DETACH DATABASE backup');
      }
      const n = await db.getFirstAsync<{ notes: number; cards: number }>(
        'SELECT (SELECT COUNT(*) FROM notes) AS notes, (SELECT COUNT(*) FROM cards) AS cards',
      );
      return { notes: n?.notes ?? 0, cards: n?.cards ?? 0, media };
    },
    async sqliteFileKind(path) {
      await db.runAsync('ATTACH DATABASE ? AS picked', path);
      try {
        const rows = await db.getAllAsync<{ name: string }>("SELECT name FROM picked.sqlite_master WHERE type = 'table'");
        return sqliteFileKind(rows.map((r) => r.name));
      } finally {
        await db.runAsync('DETACH DATABASE picked');
      }
    },
    async readExportBundle(path) {
      await db.runAsync('ATTACH DATABASE ? AS bundle', path);
      try {
        const row = await db.getFirstAsync<{ json: string }>('SELECT json FROM bundle.export');
        if (!row) throw new Error("The export is empty. Run the exporter again.");
        // Row by row, so a few hundred megabytes of images never sit in memory at once.
        let media = 0;
        for await (const m of db.getEachAsync<{ name: string; data: Uint8Array }>('SELECT name, data FROM bundle.media')) {
          await writeMedia(m.name, m.data);
          media++;
        }
        return { json: row.json, media };
      } finally {
        await db.runAsync('DETACH DATABASE bundle');
      }
    },
  };
}
