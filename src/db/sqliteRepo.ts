import { File } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import { registerUnicase } from '../../modules/anki-unicase';
import { parseAnswerButtons } from '../core/answerButtons';
import { DEFAULT_COLLECTION_SETTINGS } from '../core/config';
import type { CollectionSettings } from '../core/types';
import { parseThaiTextSize } from '../core/script';
import { parseVoiceSettings } from '../core/voices';
import type { Card, DeckParams, DeckSettings, Note, NoteType, ReviewLogEntry } from '../core/types';
import { clearMedia, listMedia, writeMedia } from '../media/mediaFiles';
import { ankiFolder, fileSink, fileSource, keptCollectionFile } from '../anki/files';
import { ANKI_SETTING_KEYS, makeAnkiLink, type AnkiLink } from './ankiLink';
import { restorePlan, sqliteFileKind } from './backup';
import type { Repo } from './repo';
import { ankiCollectionPlan, CARD_COLUMNS, CARD_RETIRE_SQL, CARD_ROWS_SQL, CARD_UPSERT_SQL, NOTE_COLUMNS, NOTE_ROWS_SQL, NOTE_UPSERT_SQL, rowValues, type SqlValue } from './ankiApply';

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
-- Forms practice (src/core/forms.ts): one row per answered prompt. Franki's own, never sent to Anki.
CREATE TABLE IF NOT EXISTS form_practice (
  id INTEGER PRIMARY KEY AUTOINCREMENT, note_id TEXT NOT NULL, form_key TEXT NOT NULL,
  correct INTEGER NOT NULL, practiced_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS form_practice_at ON form_practice(practiced_at);
-- Grammar drills (src/core/grammarDrills.ts): one row per answered question. Franki's own, never
-- sent to Anki; each point's next drill is worked out from these, never stored.
CREATE TABLE IF NOT EXISTS grammar_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, point_id TEXT NOT NULL, drill_id TEXT NOT NULL,
  kind TEXT NOT NULL, correct INTEGER NOT NULL, answered_at TEXT NOT NULL
);
-- Each media file's SHA-1 as of the last sync (src/anki/sync/mediaSync.ts). Not in a backup:
-- a restore clears it, so the next sync checks the restored files again.
CREATE TABLE IF NOT EXISTS anki_media (name TEXT PRIMARY KEY, sha1 TEXT NOT NULL);
-- Media files made here (a recording) and not yet sent to the sync server, with their SHA-1 when
-- made (src/anki/sync/mediaSync.ts, pushMedia). Not in a backup either.
CREATE TABLE IF NOT EXISTS anki_media_pending (name TEXT PRIMARY KEY, sha1 TEXT NOT NULL);
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
  { table: 'cards', column: 'anki_id', sql: 'ALTER TABLE cards ADD COLUMN anki_id TEXT' },
  { table: 'cards', column: 'buried_at', sql: 'ALTER TABLE cards ADD COLUMN buried_at TEXT' },
  { table: 'cards', column: 'deck', sql: 'ALTER TABLE cards ADD COLUMN deck TEXT' },
  { table: 'cards', column: 'filtered_deck', sql: 'ALTER TABLE cards ADD COLUMN filtered_deck TEXT' },
  { table: 'cards', column: 'position', sql: 'ALTER TABLE cards ADD COLUMN position INTEGER' },
  { table: 'cards', column: 'anki_mod', sql: 'ALTER TABLE cards ADD COLUMN anki_mod INTEGER' },
  { table: 'cards', column: 'filtered_due', sql: 'ALTER TABLE cards ADD COLUMN filtered_due INTEGER' },
  { table: 'cards', column: 'preview_due', sql: 'ALTER TABLE cards ADD COLUMN preview_due TEXT' },
  { table: 'cards', column: 'flag', sql: 'ALTER TABLE cards ADD COLUMN flag INTEGER' },
  { table: 'form_practice', column: 'given', sql: 'ALTER TABLE form_practice ADD COLUMN given TEXT' },
  { table: 'reviews', column: 'interday', sql: 'ALTER TABLE reviews ADD COLUMN interday INTEGER NOT NULL DEFAULT 0' },
  { table: 'reviews', column: 'deck', sql: 'ALTER TABLE reviews ADD COLUMN deck TEXT' },
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
 * Backup and restore, which only the SQLite repo can do: they work on database files, and carry
 * the media folder and the kept Anki collection in and out with them.
 */
export interface BackupStore {
  /** Writes a consistent copy of the whole database, media included, to `path` (a file path, not a URI). */
  backupTo(path: string): Promise<{ media: number }>;
  /** Replaces everything here, media included, with the backup at `path`. Throws `NotABackupError` for another kind of file. */
  restoreFrom(path: string): Promise<{ notes: number; cards: number; media: number }>;
  /** What the SQLite file at `path` is: one of our backups, or something else. */
  sqliteFileKind(path: string): Promise<'backup' | 'other'>;
  /** When `backupTo` last succeeded (ISO), or null. Kept outside what a restore replaces. */
  lastBackupAt(): Promise<string | null>;
  /** The deck list as last loaded (`encodeDeckSnapshot`), for the next cold start to show at once. Not in a backup. */
  deckListSnapshot(): Promise<string | null>;
  saveDeckListSnapshot(json: string): Promise<void>;
}

// The file keeps its first name: renaming it would leave an installed copy's data behind.
export async function openRepo(name = 'flashcards.db'): Promise<Repo & BackupStore & AnkiLink> {
  // Before any connection opens: every one opened after this has Anki's collation, so a sync
  // can write Anki's decks, deck options, note types and tags (modules/anki-unicase). A build
  // without the module returns false, and a sync downloads whole collections for those instead.
  registerUnicase();
  const db = await SQLite.openDatabaseAsync(name);
  // A sync writes the kept Anki collection on a connection of its own; reads of it here wait out
  // that sync's commit instead of failing with "database is locked".
  await db.execAsync('PRAGMA busy_timeout = 5000');
  await db.execAsync(SCHEMA);
  await migrate(db);
  const collectionSettings = async (): Promise<CollectionSettings> => {
    const r = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'collection_settings'");
    try { return { ...DEFAULT_COLLECTION_SETTINGS, ...(r ? JSON.parse(r.value) : {}) }; } catch { return DEFAULT_COLLECTION_SETTINGS; }
  };
  const anki = makeAnkiLink(db, collectionSettings);

  const rowToCard = (r: any): Card => ({
    id: r.id, noteId: r.note_id, kind: r.kind, suspended: !!r.suspended, retired: !!r.retired, ankiId: r.anki_id ?? undefined,
    buriedAt: r.buried_at ?? undefined, deck: r.deck ?? undefined, filteredDeck: r.filtered_deck ?? undefined,
    position: r.position ?? undefined, ankiMod: r.anki_mod ?? undefined, filteredDue: r.filtered_due ?? undefined,
    previewDue: r.preview_due ?? undefined, flag: r.flag || undefined, sched: JSON.parse(r.sched),
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
            'INSERT INTO cards (id, note_id, kind, suspended, retired, anki_id, buried_at, deck, filtered_deck, position, anki_mod, filtered_due, preview_due, flag, sched, state, due) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
              'ON CONFLICT(id) DO UPDATE SET retired = 0, anki_id = COALESCE(excluded.anki_id, cards.anki_id), buried_at = excluded.buried_at, ' +
              'deck = excluded.deck, filtered_deck = excluded.filtered_deck, position = excluded.position, ' +
              'anki_mod = excluded.anki_mod, filtered_due = excluded.filtered_due, preview_due = excluded.preview_due, flag = excluded.flag, ' +
              'suspended = CASE WHEN cards.state = 0 THEN excluded.suspended ELSE cards.suspended END, ' +
              'sched = CASE WHEN cards.state = 0 THEN excluded.sched ELSE cards.sched END, ' +
              'due = CASE WHEN cards.state = 0 THEN excluded.due ELSE cards.due END, ' +
              'state = CASE WHEN cards.state = 0 THEN excluded.state ELSE cards.state END',
            c.id, c.noteId, c.kind, c.suspended ? 1 : 0, c.ankiId ?? null, c.buriedAt ?? null, c.deck ?? null, c.filteredDeck ?? null, c.position ?? null,
            c.ankiMod ?? null, c.filteredDue ?? null, c.previewDue ?? null, c.flag ?? 0,
            JSON.stringify(c.sched), c.sched.state, c.sched.due,
          );
        }
      });
    },
    async applyAnkiCollection(notes, cards) {
      // Only the rows that change (ankiApply.ts), each through one prepared statement: rewriting
      // every row, one async call each, was most of a refresh after a sync.
      await db.withTransactionAsync(async () => {
        const [noteRows, cardRows] = await Promise.all([
          db.getAllAsync<Record<string, unknown>>(NOTE_ROWS_SQL), db.getAllAsync<Record<string, unknown>>(CARD_ROWS_SQL),
        ]);
        const plan = ankiCollectionPlan(
          { notes: noteRows.map((r) => rowValues(r, NOTE_COLUMNS)), cards: cardRows.map((r) => rowValues(r, CARD_COLUMNS)) },
          notes, cards,
        );
        const runAll = async (sql: string, rows: SqlValue[][]) => {
          if (!rows.length) return;
          const statement = await db.prepareAsync(sql);
          try {
            for (const r of rows) await statement.executeAsync(r);
          } finally {
            await statement.finalizeAsync();
          }
        };
        await runAll(NOTE_UPSERT_SQL, plan.notes);
        // Anki's cards no longer in the collection: retired, keeping their history here.
        await runAll(CARD_RETIRE_SQL, plan.retire.map((id) => [id]));
        // Anki's copy is the record: everything is overwritten, studied here or not.
        await runAll(CARD_UPSERT_SQL, plan.cards);
      });
    },
    async listNotes() {
      return (await db.getAllAsync('SELECT * FROM notes')).map(rowToNote);
    },
    async deleteNote(id) {
      await db.withTransactionAsync(async () => {
        await db.runAsync('DELETE FROM reviews WHERE card_id IN (SELECT id FROM cards WHERE note_id = ?)', id);
        await db.runAsync('DELETE FROM form_practice WHERE note_id = ?', id);
        await db.runAsync('DELETE FROM cards WHERE note_id = ?', id);
        await db.runAsync('DELETE FROM notes WHERE id = ?', id);
      });
    },
    async getNote(id) {
      const r = await db.getFirstAsync('SELECT * FROM notes WHERE id = ?', id);
      return r ? rowToNote(r) : undefined;
    },
    async deleteNotesAndCards(noteIds, cardIds) {
      await db.withTransactionAsync(async () => {
        for (const id of noteIds) {
          await db.runAsync('DELETE FROM reviews WHERE card_id IN (SELECT id FROM cards WHERE note_id = ?)', id);
          await db.runAsync('DELETE FROM form_practice WHERE note_id = ?', id);
          await db.runAsync('DELETE FROM cards WHERE note_id = ?', id);
          await db.runAsync('DELETE FROM notes WHERE id = ?', id);
        }
        for (const id of cardIds) {
          await db.runAsync('DELETE FROM reviews WHERE card_id = ?', id);
          await db.runAsync('DELETE FROM cards WHERE id = ?', id);
        }
      });
    },
    async renameDeck(from, to) {
      // The deck and those under it, in each column: "A" takes "A" and "A::...", not "AB".
      const under = (col: string) => `(${col} = ? OR substr(${col}, 1, length(?)) = ?)`;
      const args = [from, `${from}::`, `${from}::`];
      const renamed = (col: string) => `? || substr(${col}, length(?) + 1)`;
      await db.withTransactionAsync(async () => {
        await db.runAsync(`UPDATE notes SET deck = ${renamed('deck')} WHERE ${under('deck')}`, to, from, ...args);
        await db.runAsync(`UPDATE cards SET deck = ${renamed('deck')} WHERE ${under('deck')}`, to, from, ...args);
        await db.runAsync(`UPDATE cards SET filtered_deck = ${renamed('filtered_deck')} WHERE ${under('filtered_deck')}`, to, from, ...args);
        // Settings kept by deck: any left under the new name by a deck deleted in Anki give way.
        for (const table of ['deck_params', 'deck_settings']) {
          await db.runAsync(`UPDATE OR REPLACE ${table} SET deck = ${renamed('deck')} WHERE ${under('deck')}`, to, from, ...args);
        }
      });
    },
    async forgetDeck(deck) {
      await db.withTransactionAsync(async () => {
        for (const table of ['deck_params', 'deck_settings']) {
          await db.runAsync(`DELETE FROM ${table} WHERE deck = ? OR substr(deck, 1, length(?)) = ?`, deck, `${deck}::`, `${deck}::`);
        }
      });
    },
    async listCards(deck) {
      // The deck and its subdecks: "A" takes "A" and "A::...", not "AB". length() counts
      // characters, as substr() does; a JS string's length counts UTF-16 units, so with an emoji
      // in the name ("👅 Languages") the prefix came out short and every subdeck was missed.
      const rows = deck
        ? await db.getAllAsync(
            'SELECT c.* FROM cards c JOIN notes n ON n.id = c.note_id WHERE n.deck = ? OR substr(n.deck, 1, length(?)) = ?',
            deck, `${deck}::`, `${deck}::`,
          )
        : await db.getAllAsync('SELECT * FROM cards');
      return rows.map(rowToCard);
    },
    async saveCard(c) {
      await db.runAsync(
        'UPDATE cards SET suspended = ?, retired = ?, buried_at = ?, deck = ?, filtered_deck = ?, position = ?, anki_mod = ?, filtered_due = ?, preview_due = ?, flag = ?, ' +
          'sched = ?, state = ?, due = ? WHERE id = ?',
        c.suspended ? 1 : 0, c.retired ? 1 : 0, c.buriedAt ?? null, c.deck ?? null, c.filteredDeck ?? null, c.position ?? null,
            c.ankiMod ?? null, c.filteredDue ?? null, c.previewDue ?? null, c.flag ?? 0,
        JSON.stringify(c.sched), c.sched.state, c.sched.due, c.id,
      );
    },
    async addReview(e: ReviewLogEntry) {
      const r = await db.runAsync(
        'INSERT INTO reviews (card_id, rating, reviewed_at, state, due, stability, difficulty, interday, deck) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        e.cardId, e.rating, e.reviewedAt, e.state, e.due, e.stability, e.difficulty, e.interday ? 1 : 0, e.deck ?? null,
      );
      return r.lastInsertRowId;
    },
    async deleteReview(id) {
      await db.runAsync('DELETE FROM reviews WHERE id = ?', id);
    },
    async addPractice(p) {
      await db.runAsync(
        'INSERT INTO form_practice (note_id, form_key, correct, practiced_at, given) VALUES (?, ?, ?, ?, ?)',
        p.noteId, p.key, p.correct ? 1 : 0, p.practicedAt, p.given ?? null,
      );
    },
    async listPractice(since) {
      // ISO strings are all UTC, so comparing them as text compares the instants.
      const rows = await db.getAllAsync<{ note_id: string; form_key: string; correct: number; practiced_at: string; given: string | null }>(
        'SELECT note_id, form_key, correct, practiced_at, given FROM form_practice WHERE practiced_at >= ? ORDER BY practiced_at',
        since ? since.toISOString() : '',
      );
      return rows.map((r) => ({ noteId: r.note_id, key: r.form_key, correct: !!r.correct, practicedAt: r.practiced_at, ...(r.given != null ? { given: r.given } : {}) }));
    },
    async addGrammarAnswer(a) {
      await db.runAsync(
        'INSERT INTO grammar_answers (point_id, drill_id, kind, correct, answered_at) VALUES (?, ?, ?, ?, ?)',
        a.pointId, a.drillId, a.kind, a.correct ? 1 : 0, a.answeredAt,
      );
    },
    async listGrammarAnswers() {
      const rows = await db.getAllAsync<{ point_id: string; drill_id: string; kind: string; correct: number; answered_at: string }>(
        'SELECT point_id, drill_id, kind, correct, answered_at FROM grammar_answers ORDER BY answered_at',
      );
      return rows.map((r) => ({ pointId: r.point_id, drillId: r.drill_id, kind: r.kind === 'which' ? 'which' : 'gap', correct: !!r.correct, answeredAt: r.answered_at }));
    },
    async formsAnswerMode() {
      const r = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'forms_answer_mode'");
      return r?.value === 'type' ? 'type' : 'pick';
    },
    async saveFormsAnswerMode(mode) {
      await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('forms_answer_mode', ?)", mode);
    },
    async grammarHintsDismissed() {
      const r = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'grammar_hints_dismissed'");
      try {
        const parsed: unknown = r ? JSON.parse(r.value) : {};
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
      } catch {
        return {};
      }
    },
    async saveGrammarHintsDismissed(dismissed) {
      await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('grammar_hints_dismissed', ?)", JSON.stringify(dismissed));
    },
    async voiceSettings() {
      const r = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'voices'");
      return parseVoiceSettings(r?.value);
    },
    async saveVoiceSettings(settings) {
      await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('voices', ?)", JSON.stringify(settings));
    },
    async answerButtons() {
      const r = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'answer_buttons'");
      return parseAnswerButtons(r?.value);
    },
    async saveAnswerButtons(choice) {
      await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('answer_buttons', ?)", choice);
    },
    collectionSettings,
    async saveCollectionSettings(settings) {
      await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('collection_settings', ?)", JSON.stringify(settings));
    },
    async swipeToRate() {
      const r = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'swipe_to_rate'");
      return r?.value === '1';
    },
    async saveSwipeToRate(on) {
      await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('swipe_to_rate', ?)", on ? '1' : '0');
    },
    async showCardHints() {
      const r = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'show_card_hints'");
      return r?.value === '1';
    },
    async saveShowCardHints(on) {
      await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('show_card_hints', ?)", on ? '1' : '0');
    },
    async thaiTextSize() {
      const r = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'thai_text_size'");
      return parseThaiTextSize(r?.value);
    },
    async saveThaiTextSize(size) {
      await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('thai_text_size', ?)", size);
    },
    async listReviews(since) {
      // ISO strings are all UTC, so comparing them as text compares the instants.
      const rows = await db.getAllAsync<{ card_id: string; rating: number; reviewed_at: string; state: number; due: string; stability: number; difficulty: number; interday: number; deck: string | null }>(
        'SELECT card_id, rating, reviewed_at, state, due, stability, difficulty, interday, deck FROM reviews WHERE reviewed_at >= ? ORDER BY reviewed_at', since.toISOString(),
      );
      return rows.map((r) => ({
        cardId: r.card_id, rating: r.rating as ReviewLogEntry['rating'], reviewedAt: r.reviewed_at,
        state: r.state, due: r.due, stability: r.stability, difficulty: r.difficulty, interday: !!r.interday, deck: r.deck ?? undefined,
      }));
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
    // Under the Anki lock, so a sync or an answer can't write the kept collection while it's copied.
    backupTo: (path) => anki.lockAnki(async () => {
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
      // The kept Anki collection too, in 1 MB pieces so it never has to be in memory whole: a
      // backup without it would restore answers that can no longer be sent to Anki.
      const kept = await anki.keptCollection();
      if (kept) {
        await db.runAsync('ATTACH DATABASE ? AS backup', path);
        try {
          await db.execAsync('CREATE TABLE backup.anki_collection (seq INTEGER PRIMARY KEY, data BLOB NOT NULL)');
          const src = fileSource(kept);
          for (let seq = 0; ; seq++) {
            const chunk = await src.read(1024 * 1024);
            if (chunk === null) break;
            await db.runAsync('INSERT INTO backup.anki_collection (seq, data) VALUES (?, ?)', seq, chunk);
          }
        } finally {
          await db.runAsync('DETACH DATABASE backup');
        }
      }
      await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_backup_at', ?)", new Date().toISOString());
      return { media: files.length };
    }),
    async lastBackupAt() {
      const r = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'last_backup_at'");
      return r?.value ?? null;
    },
    async deckListSnapshot() {
      const r = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'deck_list_snapshot'");
      return r?.value ?? null;
    },
    async saveDeckListSnapshot(json) {
      await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('deck_list_snapshot', ?)", json);
    },
    // Under the Anki lock: the kept collection is swapped, which a sync's own connection mustn't be holding.
    restoreFrom: (path) => anki.lockAnki(async () => {
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
      const incoming = new File(ankiFolder(), 'restoring.anki2');
      await db.runAsync('ATTACH DATABASE ? AS backup', path);
      try {
        const plan = restorePlan(await columnsOf('main'), await columnsOf('backup'));
        // The kept Anki collection, and the settings that go with it, are the backup's: replaced
        // by its copy, or removed when the backup has none. Its copy is written beside the current
        // one before anything changes, so a failure reading it leaves the rows and the collection
        // as they were, never the backup's cards with this phone's collection.
        const hasAnki = await db.getFirstAsync("SELECT 1 FROM backup.sqlite_master WHERE type = 'table' AND name = 'anki_collection'");
        if (hasAnki) {
          const sink = fileSink(incoming);
          for await (const row of db.getEachAsync<{ data: Uint8Array }>('SELECT data FROM backup.anki_collection ORDER BY seq')) {
            await sink.write(row.data);
          }
          await sink.close();
        }
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
        await anki.detachAnki();
        const kept = keptCollectionFile();
        if (kept.exists) kept.delete();
        if (hasAnki) await incoming.move(kept);
        // The collection's own settings (its day start, creation time) go with it, as what was sent does.
        for (const key of [...ANKI_SETTING_KEYS, 'collection_settings']) {
          await db.runAsync('DELETE FROM main.settings WHERE key = ?', key);
          await db.runAsync('INSERT INTO main.settings (key, value) SELECT key, value FROM backup.settings WHERE key = ?', key);
        }
        const hasMedia = await db.getFirstAsync("SELECT 1 FROM backup.sqlite_master WHERE type = 'table' AND name = 'media'");
        if (hasMedia) {
          clearMedia();
          for await (const row of db.getEachAsync<{ name: string; data: Uint8Array }>('SELECT name, data FROM backup.media')) {
            await writeMedia(row.name, row.data);
            media++;
          }
          await anki.forgetMediaSync();
        }
      } finally {
        if (incoming.exists) incoming.delete(); // left by a failure before it was moved into place
        await db.runAsync('DETACH DATABASE backup');
        await anki.attachAnki();
      }
      const n = await db.getFirstAsync<{ notes: number; cards: number }>(
        'SELECT (SELECT COUNT(*) FROM notes) AS notes, (SELECT COUNT(*) FROM cards) AS cards',
      );
      return { notes: n?.notes ?? 0, cards: n?.cards ?? 0, media };
    }),
    async sqliteFileKind(path) {
      await db.runAsync('ATTACH DATABASE ? AS picked', path);
      try {
        const rows = await db.getAllAsync<{ name: string }>("SELECT name FROM picked.sqlite_master WHERE type = 'table'");
        return sqliteFileKind(rows.map((r) => r.name));
      } finally {
        await db.runAsync('DETACH DATABASE picked');
      }
    },
    ...anki,
  };
}
