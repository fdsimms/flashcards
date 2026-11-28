import * as SQLite from 'expo-sqlite';
import { inSchema, keptSql, stripUnicaseIn } from '../anki/attachedSql';
import { deckAndParents, studiedDelta, studiedOn, withStudied, type DeckStatsRow } from '../anki/deckStats';
import type { AnkiDeckStudied } from '../core/queue';
import { queryCollectionRows, type CollectionRows } from '../anki/collection';
import { dailyGoalsByName, goalReplacedByName, setAnkiDailyGoal, setAnkiGoalReplaced } from '../anki/dailyGoals';
import { gatesByName, setAnkiProgressGate } from '../anki/progressGates';
import { setAnkiAudioVoice, type AudioVoice } from '../anki/audioVoices';
import { NATIVE_OFF, nativeConfigFromValue, setAnkiNativeRecordings, type NativeRecordingsConfig } from '../anki/nativeRecordings';
import { setAnkiSkillSettings, skillSettingsByName, type SkillSettings } from '../anki/skillSettings';
import { ankiFolder, keptCollectionFile, pathOf, workFolder } from '../anki/files';
import {
  cardRestoreParams, cardStateParams, cardUpdate, cardUpdateParams, ankiDayNumber, nextRevlogId, previewAgain, previewReturn, previewRevlogEntry, revlogEntry, revlogParams, type AnkiCardRow, type AnkiUndo,
} from '../anki/writeback';
import type { SqlValue, SyncDb } from '../anki/sync/collectionSync';
import type { MediaState } from '../anki/sync/mediaSync';
import type { RatingValue } from '../core/scheduler';
import type { RevlogRow } from '../core/stats';
import type { CardState } from '../core/cardState';
import type { Card, CollectionSettings } from '../core/types';
import { File } from 'expo-file-system';
import { fileUriToPath } from './backup';
import { decodeOwed, encodeOwed, type AnkiAnswer, type OwedAnswer } from '../anki/owedAnswers';
import { transact } from './transact';
import { Refusal } from '../core/failure';
import { NO_COLLECTION } from '../anki/noteService';

/**
 * The Anki collection Franki keeps (Documents/anki/collection.anki2), attached to the app's one
 * SQLite connection as `anki`. Imported from Anki whole, written to on every answer, and packed
 * back up for Anki on "Send to Anki". Franki itself edits it only through `cards` and `revlog`,
 * whose columns use no custom collation, so it stays exactly the file Anki wrote plus Franki's
 * answers. A sync with an Anki server (src/anki/sync) sends the rows these writes mark unsynced
 * (usn -1) and writes what Anki's own sync writes, on a connection of its own to the same file.
 */

export interface AnkiStatus {
  /** Whether Franki holds an Anki collection at all. */
  linked: boolean;
  /**
   * Answers given in Franki and not yet in Anki: neither synced (a sync marks them sent) nor
   * handed back by file since (`markSentToAnki`).
   */
  unsent: number;
  lastSentAt: string | null;
}

export type { AnkiUndo };

/** Sync with an Anki server: off until set up. The sign-in key itself is in the Keychain, not here. */
export interface SyncSettings {
  enabled: boolean;
  server: string;
  user: string;
  lastSyncAt: string | null;
  /** The last sync's failure, as shown to the person, or null when it worked. */
  lastError: string | null;
}

export interface AnkiLink {
  ankiStatus(): Promise<AnkiStatus>;
  /**
   * Notes, deletions and card changes in the kept collection that a sync hasn't sent yet, besides
   * answers (`ankiStatus().unsent`): what a full download would also lose. Read only for sync,
   * which marks them sent; without sync ("Send to Anki"), nothing does.
   */
  ankiUnsentEdits(): Promise<number>;
  /** A collection's rows for the importer, read from a scratch copy (the original is untouched). */
  readAnkiRows(collection: File): Promise<CollectionRows>;
  /** Makes `collection` the one Franki keeps (it's moved, not copied), replacing any before it. */
  keepAnkiCollection(collection: File): Promise<void>;
  /** Writes an answer into the kept collection. Undefined when the card isn't from it. */
  /**
   * `owedId`: the answer's row in `anki_owed` (`oweAnkiAnswer`), deleted in the write's own
   * transaction. If the row is already gone the answer was written before, and nothing is written.
   */
  writeAnkiAnswer(a: AnkiAnswer & { owedId?: number }): Promise<AnkiUndo | undefined>;
  /** Keeps an answer as owed to the kept collection (src/anki/owedAnswers.ts), and returns its id. */
  oweAnkiAnswer(owed: OwedAnswer): Promise<number>;
  /** The answers still owed, oldest first. One that can't be read back is dropped. */
  owedAnkiAnswers(): Promise<{ id: number; owed: OwedAnswer }[]>;
  forgetOwedAnkiAnswer(id: number): Promise<void>;
  /**
   * Takes an answer back out of the kept collection. False, changing nothing, when it was already
   * synced (or the collection was replaced since): it's in the server's history, so as in Anki,
   * undo stops at the last sync.
   */
  undoAnkiAnswer(u: AnkiUndo): Promise<boolean>;
  /** Suspends, buries or flags cards in the kept collection, as Anki writes it (`cardStateParams`). */
  setAnkiCardStates(changes: { ankiId: string; state: CardState }[], now: Date): Promise<void>;
  /** The kept collection's file, ready to pack, or null without one. */
  keptCollection(): Promise<File | null>;
  markSentToAnki(): Promise<void>;
  /** The kept collection's review log from `since` on: Anki's whole history plus Franki's answers (for stats). */
  ankiReviewLog(since: Date): Promise<RevlogRow[]>;
  /** Every deck in the kept collection, named as Franki names them ("A::B"); none without one. */
  ankiDecks(): Promise<{ id: number; name: string }[]>;
  /**
   * Each of the kept collection's decks with its "studied today" counts on Anki's day `today`, as Anki
   * keeps them (deckStats.ts): every device's answers, each counted on the deck it was given in and
   * every deck above it. None without a collection.
   */
  ankiDeckStudied(today: number): Promise<AnkiDeckStudied[]>;
  /**
   * The progress gates kept in the collection, by deck name (`src/anki/progressGates.ts`); none
   * without one. Read from the attached collection, so it doesn't wait for a sync.
   */
  ankiProgressGates(): Promise<Map<string, number>>;
  /** Sets or, with no cap, removes a deck's gate in the collection, which a sync carries. False when Anki has no such deck. Waits for the lock. */
  setAnkiProgressGate(deck: string, cap: number | undefined, now?: Date): Promise<boolean>;
  /** Each deck's daily goal kept in the collection (`src/anki/dailyGoals.ts`), by deck name; none without one. Read without the lock. */
  ankiDailyGoals(): Promise<Map<string, number>>;
  /** Sets or, with none, removes a deck's daily goal in the collection, which a sync carries. False when Anki has no such deck. Waits for the lock. */
  setAnkiDailyGoal(deck: string, goal: number | undefined, now?: Date): Promise<boolean>;
  /** What each deck's goal replaced, kept in the collection (`src/anki/dailyGoals.ts`), by deck name (null: none of its own). Read without the lock. */
  ankiGoalReplaced(): Promise<Map<string, number | null>>;
  /** Sets or, with undefined, removes what a deck's goal replaced, which a sync carries. False when Anki has no such deck. Waits for the lock. */
  setAnkiGoalReplaced(deck: string, value: number | null | undefined, now?: Date): Promise<boolean>;
  /** Each deck's skill card settings kept in the collection (`src/anki/skillSettings.ts`), by deck name; a deck with none has the defaults. Read without a sync. */
  ankiSkillSettings(): Promise<Map<string, SkillSettings>>;
  /** Saves a deck's skill card settings in the collection, which a sync carries. False when Anki has no such deck. Waits for the lock. */
  setAnkiSkillSettings(deck: string, settings: SkillSettings, now?: Date): Promise<boolean>;
  /**
   * Sets, or with none removes, the Azure voice the MCP records a language's new notes with (`src/anki/audioVoices.ts`) in the
   * collection, which a sync carries. Only that language changes. Does nothing while Franki has no Anki collection, since
   * there is nothing yet for the MCP to read. Waits for the lock.
   */
  setAnkiAudioVoice(language: string, voice: AudioVoice | null, now?: Date): Promise<void>;
  /** Whether words get native speakers' recordings (`src/anki/nativeRecordings.ts`); off without a collection. Read without the lock. */
  ankiNativeRecordings(): Promise<NativeRecordingsConfig>;
  /** Saves that setting in the kept collection; nothing without one. */
  setAnkiNativeRecordings(config: NativeRecordingsConfig, now?: Date): Promise<void>;
  /** For backup and restore, which carry the kept collection: let go of the file, and take it back. */
  detachAnki(): Promise<void>;
  attachAnki(): Promise<void>;

  /**
   * Runs `fn` with the kept collection to itself: answer and undo writes wait until it's done.
   * A sync and an import of a whole collection hold it.
   */
  lockAnki<T>(fn: () => Promise<T>): Promise<T>;
  /**
   * What the lock has done so far: how many times it was taken, and whether it's held now. A caller
   * that reads it before and after its own `lockAnki` call knows whether anyone else (a sync, an
   * import) held the collection in between, or still did when it first looked.
   */
  ankiLockState(): { runs: number; held: boolean };
  /** A connection of its own to the kept collection, for a sync; closed after `fn`. Call inside `lockAnki`. */
  withSyncConnection<T>(fn: (db: SyncDb) => Promise<T>): Promise<T>;
  /** What the media pull remembers between syncs. */
  mediaSyncState(): MediaState;
  /** Forgets it, after a restore puts back a backup's media folder: the next sync checks every file again. */
  forgetMediaSync(): Promise<void>;
  syncSettings(): Promise<SyncSettings>;
  saveSyncSettings(patch: Partial<SyncSettings>): Promise<void>;
}

const SETTING = { lastSentId: 'anki_last_sent_revlog_id', lastSentAt: 'anki_last_sent_at' };
/** The settings that belong to the kept collection, and so travel with it in a backup. */
export const ANKI_SETTING_KEYS = Object.values(SETTING);

/** This phone's own: not in a backup, which shouldn't turn sync on or off or move it to another server. */
const SYNC = {
  enabled: 'sync_enabled', server: 'sync_server', user: 'sync_user', lastSyncAt: 'sync_last_at',
  lastError: 'sync_last_error', mediaUsn: 'sync_media_usn',
};

const SQL = keptSql('anki');

/** `collectionSettings` reads the collection's settings as the repo keeps them, so Anki's day numbers are counted as the rest of the app counts them. */
export function makeAnkiLink(db: SQLite.SQLiteDatabase, collectionSettings: () => Promise<CollectionSettings>): AnkiLink {
  let attached = false;
  // One holder of the kept collection at a time, in the order they asked.
  let queue: Promise<unknown> = Promise.resolve();
  let lockRuns = 0;
  let lockHeld = false;
  const lockAnki = <T,>(fn: () => Promise<T>): Promise<T> => {
    const counted = async () => {
      lockRuns++;
      lockHeld = true;
      try { return await fn(); } finally { lockHeld = false; }
    };
    const run = queue.then(counted, counted);
    queue = run.catch(() => undefined);
    return run;
  };

  const getSetting = async (key: string) =>
    (await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key))?.value ?? null;
  const setSetting = (key: string, value: string) =>
    db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', key, value);

  // The deck list's load reads several things at once, and each one attaches first. Without this
  // the second ATTACH ran while the first was awaiting and failed with "database anki is already
  // in use", shown as "Couldn't load your decks" on every cold start. Callers share one attach.
  let attaching: Promise<void> | null = null;
  const attach = async () => {
    if (attached || !keptCollectionFile().exists) return;
    attaching ??= (async () => {
      try {
        await db.runAsync('ATTACH DATABASE ? AS anki', pathOf(keptCollectionFile()));
        // A rollback journal rather than WAL: after every write the file on disk is complete, so it
        // can be packed or backed up without a checkpoint. Anki turns WAL back on when it opens it.
        await db.execAsync('PRAGMA anki.journal_mode = DELETE');
        attached = true;
      } finally {
        attaching = null;
      }
    })();
    await attaching;
  };
  const detach = async () => {
    if (!attached) return;
    await db.execAsync('DETACH DATABASE anki');
    attached = false;
  };

  // Not `lockAnki`: the callers (a deck move's refresh, a sync's download) already hold that. But
  // two reads can overlap (a sync's refresh runs outside the lock), and they share the `scratch`
  // name and file on this connection: the second one's attach or detach failed with "database
  // scratch is locked". So reads wait for each other.
  let scratchQueue: Promise<unknown> = Promise.resolve();
  // A DETACH can fail ("database scratch is locked") while a write transaction on this shared
  // connection is open, since the scratch reads enrolled in it. The failed detach left `scratch`
  // attached for the rest of the app's run, so every later sync failed on its ATTACH with
  // "database scratch is already in use". So the detach waits out a busy moment, and a read
  // starts by detaching whatever an earlier one left behind.
  const detachScratch = async () => {
    for (let attempt = 0; ; attempt++) {
      const open = await db.getAllAsync<{ name: string }>('PRAGMA database_list');
      if (!open.some((d) => d.name === 'scratch')) return;
      try {
        await db.execAsync('DETACH DATABASE scratch');
        return;
      } catch (e) {
        if (attempt >= 5) throw e;
        await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
      }
    }
  };
  const readRows = async (collection: File): Promise<CollectionRows> => {
    const scratch = new File(workFolder('anki-read'), 'scratch.anki2');
    await detachScratch();
    await collection.copy(scratch);
    const p = pathOf(scratch);
    await db.runAsync('ATTACH DATABASE ? AS scratch', p);
    try {
      await db.execAsync('PRAGMA scratch.journal_mode = DELETE');
      // Only on the scratch copy: Anki's own collation removed so its three collated tables
      // can be read at all (see collection.ts).
      await db.execAsync('PRAGMA writable_schema = ON');
      await db.execAsync(stripUnicaseIn('scratch'));
      await db.execAsync('PRAGMA writable_schema = OFF');
    } finally {
      await detachScratch();
    }
    // Attached again so SQLite reads the edited schema.
    await db.runAsync('ATTACH DATABASE ? AS scratch', p);
    try {
      return await queryCollectionRows((sql) => db.getAllAsync(inSchema(sql, 'scratch')));
    } finally {
      await detachScratch();
      scratch.delete();
    }
  };

  const link: AnkiLink = {
    async ankiStatus() {
      await attach();
      if (!attached) return { linked: false, unsent: 0, lastSentAt: null };
      const since = Number(await getSetting(SETTING.lastSentId) ?? 0);
      const r = await db.getFirstAsync<{ n: number }>(SQL.unsentSince, since);
      return { linked: true, unsent: r?.n ?? 0, lastSentAt: await getSetting(SETTING.lastSentAt) };
    },

    async ankiUnsentEdits() {
      await attach();
      if (!attached) return 0;
      return (await db.getFirstAsync<{ n: number }>(SQL.unsentEdits))?.n ?? 0;
    },

    readAnkiRows: (collection) => {
      const run = scratchQueue.then(() => readRows(collection), () => readRows(collection));
      scratchQueue = run.then(() => undefined, () => undefined);
      return run;
    },

    async keepAnkiCollection(collection) {
      await detach();
      ankiFolder();
      const kept = keptCollectionFile();
      for (const name of ['collection.anki2', 'collection.anki2-wal', 'collection.anki2-shm', 'collection.anki2-journal']) {
        const f = new File(ankiFolder(), name);
        if (f.exists) f.delete();
      }
      await collection.move(kept);
      await attach();
      // Everything in the collection as it arrived is Anki's own: nothing in it is unsent.
      const max = await db.getFirstAsync<{ m: number | null }>(SQL.maxRevlogId);
      await setSetting(SETTING.lastSentId, String(max?.m ?? 0));
    },

    writeAnkiAnswer: ({ before, after, rating, now, takenMs, desiredRetention, steps, weights, preview, bury = [], owedId }) => lockAnki(async () => {
      // Checked under the lock: an owed answer whose row is gone is already in the collection
      // (written by this session's own job, or by the catch-up at launch, whichever came first).
      if (owedId !== undefined && !(await db.getFirstAsync('SELECT 1 FROM anki_owed WHERE id = ?', owedId))) return undefined;
      const nothingOwed = async () => { if (owedId !== undefined) await db.runAsync('DELETE FROM anki_owed WHERE id = ?', owedId); };
      await attach();
      if (!attached || !before.ankiId) { await nothingOwed(); return undefined; }
      const cid = Number(before.ankiId);
      const row = await db.getFirstAsync<AnkiCardRow & { mod: number; usn: number }>(SQL.cardRow, cid);
      if (!row) { await nothingOwed(); return undefined; } // the card isn't in this collection (it came from an older one)
      const crt = (await db.getFirstAsync<{ crt: number }>(SQL.crt))!.crt;
      const cs = await collectionSettings();
      const clock = { crt, dayStartsAtHour: cs.dayStartsAtHour, creationOffset: cs.creationOffset };
      const latest = await db.getFirstAsync<{ m: number | null }>(SQL.maxRevlogId);
      const revlogId = nextRevlogId(now.getTime(), latest?.m ?? null);
      const buried: AnkiUndo['buried'] = [];
      for (const s of bury) {
        const sibling = s.ankiId ? await db.getFirstAsync<AnkiCardRow & { mod: number; usn: number }>(SQL.cardRow, Number(s.ankiId)) : null;
        if (sibling) buried.push({ cid: Number(s.ankiId), row: sibling });
      }
      const deckRows = await db.getAllAsync<DeckStatsRow>(SQL.deckStats);
      const decks = deckAndParents(deckRows, row.did).map(({ id, common, mtime_secs, usn }) => ({ id, common, mtime_secs, usn }));
      await transact(db, async () => {
        const update = !preview ? cardUpdate(after, row, { clock, now, desiredRetention, steps, rating, weights })
          : preview.again ? previewAgain(row, Math.floor(preview.again.getTime() / 1000), now)
          : previewReturn(row, now);
        await db.runAsync(SQL.cardUpdate, ...cardUpdateParams(update, cid));
        const entry = revlogEntry(before, after, rating, { id: revlogId, cid, previousIvl: row.ivl, now, takenMs, clock });
        await db.runAsync(SQL.revlogInsert, ...revlogParams(preview ? previewRevlogEntry(entry, row, preview.again, now) : entry));
        for (const b of buried) await db.runAsync(SQL.buryCard, Math.floor(now.getTime() / 1000), b.cid);
        // Counted on the deck the card is studied in and those above it, from the queue it was answered from.
        const today = ankiDayNumber(Math.floor(now.getTime() / 1000), clock);
        const delta = studiedDelta(row, entry.time);
        // Stamped with the clock, as Anki's set_modified does: sync keeps the deck row stamped later.
        for (const d of decks) await db.runAsync(SQL.deckStatsUpdate, withStudied(d.common, today, delta), Math.floor(Date.now() / 1000), -1, d.id);
        await db.runAsync(SQL.colModified, now.getTime());
        if (owedId !== undefined) await db.runAsync('DELETE FROM anki_owed WHERE id = ?', owedId);
      });
      return { cid, row, revlogId, buried, decks };
    }),

    async oweAnkiAnswer(owed) {
      return (await db.runAsync('INSERT INTO anki_owed (data) VALUES (?)', encodeOwed(owed))).lastInsertRowId;
    },
    async owedAnkiAnswers() {
      const rows = await db.getAllAsync<{ id: number; data: string }>('SELECT id, data FROM anki_owed ORDER BY id');
      const out: { id: number; owed: OwedAnswer }[] = [];
      for (const r of rows) {
        const owed = decodeOwed(r.data);
        if (owed) out.push({ id: r.id, owed });
        else await db.runAsync('DELETE FROM anki_owed WHERE id = ?', r.id);
      }
      return out;
    },
    async forgetOwedAnkiAnswer(id) {
      await db.runAsync('DELETE FROM anki_owed WHERE id = ?', id);
    },

    undoAnkiAnswer: (u) => lockAnki(async () => {
      await attach();
      if (!attached) return false;
      // Checked under the lock, so a sync can't send the answer between this check and the undo.
      const r = await db.getFirstAsync<{ usn: number }>(SQL.revlogUsn, u.revlogId);
      if (!r || r.usn !== -1) return false;
      await transact(db, async () => {
        await db.runAsync(SQL.cardUpdate, ...cardRestoreParams(u.row, u.cid));
        for (const b of u.buried) await db.runAsync(SQL.cardUpdate, ...cardRestoreParams(b.row, b.cid));
        for (const d of u.decks ?? []) await db.runAsync(SQL.deckStatsUpdate, d.common, d.mtime_secs, d.usn, d.id);
        await db.runAsync(SQL.revlogDelete, u.revlogId);
        await db.runAsync(SQL.colModified, Date.now());
      });
      return true;
    }),

    setAnkiCardStates: (changes, now) => lockAnki(async () => {
      await attach();
      if (!attached || !changes.length) return;
      await transact(db, async () => {
        for (const { ankiId, state } of changes) {
          const row = await db.getFirstAsync<{ type: number; queue: number; due: number; flags: number }>(SQL.cardState, Number(ankiId));
          if (row) await db.runAsync(SQL.cardStateUpdate, ...cardStateParams(row, state, now, Number(ankiId)));
        }
        await db.runAsync(SQL.colModified, now.getTime());
      });
    }),

    async keptCollection() {
      await attach();
      return attached ? keptCollectionFile() : null;
    },

    async markSentToAnki() {
      await attach();
      if (!attached) return;
      const max = await db.getFirstAsync<{ m: number | null }>(SQL.maxRevlogId);
      await setSetting(SETTING.lastSentId, String(max?.m ?? 0));
      await setSetting(SETTING.lastSentAt, new Date().toISOString());
    },

    async ankiReviewLog(since) {
      await attach();
      if (!attached) return [];
      return db.getAllAsync<RevlogRow>(SQL.revlogSince, since.getTime());
    },

    async ankiDeckStudied(today) {
      await attach();
      if (!attached) return [];
      const rows = await db.getAllAsync<DeckStatsRow>(SQL.deckStats);
      return rows.map((r) => {
        const s = studiedOn(r.common, today);
        return { deck: r.name.split('\x1f').join('::'), introduced: s.new, reviewed: s.review };
      });
    },

    async ankiDecks() {
      await attach();
      if (!attached) return [];
      const rows = await db.getAllAsync<{ id: number; name: string }>(SQL.decks);
      return rows.map((r) => ({ id: Number(r.id), name: r.name.split('\x1f').join('::') }));
    },

    async ankiProgressGates() {
      await attach();
      if (!attached) return new Map();
      const decks = (await db.getAllAsync<{ id: number; name: string }>(SQL.decks)).map((r) => ({ id: Number(r.id), name: r.name.split('\x1f').join('::') }));
      const row = await db.getFirstAsync<{ val: Uint8Array | string }>(SQL.gates);
      return gatesByName(decks, row?.val);
    },

    setAnkiProgressGate: (deck, cap, now = new Date()) => lockAnki(() => link.withSyncConnection((c) => setAnkiProgressGate(c, deck, cap, now))),

    async ankiDailyGoals() {
      await attach();
      if (!attached) return new Map();
      const decks = (await db.getAllAsync<{ id: number; name: string }>(SQL.decks)).map((r) => ({ id: Number(r.id), name: r.name.split('\x1f').join('::') }));
      const row = await db.getFirstAsync<{ val: Uint8Array | string }>(SQL.dailyGoals);
      return dailyGoalsByName(decks, row?.val);
    },

    setAnkiDailyGoal: (deck, goal, now = new Date()) => lockAnki(() => link.withSyncConnection((c) => setAnkiDailyGoal(c, deck, goal, now))),

    async ankiGoalReplaced() {
      await attach();
      if (!attached) return new Map();
      const decks = (await db.getAllAsync<{ id: number; name: string }>(SQL.decks)).map((r) => ({ id: Number(r.id), name: r.name.split('\x1f').join('::') }));
      const row = await db.getFirstAsync<{ val: Uint8Array | string }>(SQL.goalReplaced);
      return goalReplacedByName(decks, row?.val);
    },

    setAnkiGoalReplaced: (deck, value, now = new Date()) => lockAnki(() => link.withSyncConnection((c) => setAnkiGoalReplaced(c, deck, value, now))),

    async ankiSkillSettings() {
      await attach();
      if (!attached) return new Map();
      const decks = (await db.getAllAsync<{ id: number; name: string }>(SQL.decks)).map((r) => ({ id: Number(r.id), name: r.name.split('\x1f').join('::') }));
      const row = await db.getFirstAsync<{ val: Uint8Array | string }>(SQL.skillSettings);
      return skillSettingsByName(decks, row?.val);
    },

    setAnkiSkillSettings: (deck, settings, now = new Date()) => lockAnki(() => link.withSyncConnection((c) => setAnkiSkillSettings(c, deck, settings, now))),

    setAnkiAudioVoice: async (language, voice, now = new Date()) => {
      if (!keptCollectionFile().exists) return;
      await lockAnki(() => link.withSyncConnection((c) => setAnkiAudioVoice(c, language, voice, now)));
    },

    async ankiNativeRecordings() {
      await attach();
      if (!attached) return NATIVE_OFF;
      const row = await db.getFirstAsync<{ val: Uint8Array | string }>(SQL.nativeRecordings);
      return nativeConfigFromValue(row?.val);
    },

    setAnkiNativeRecordings: async (config, now = new Date()) => {
      if (!keptCollectionFile().exists) return;
      await lockAnki(() => link.withSyncConnection((c) => setAnkiNativeRecordings(c, config, now)));
    },

    detachAnki: detach,
    attachAnki: attach,

    lockAnki,
    ankiLockState: () => ({ runs: lockRuns, held: lockHeld }),

    async withSyncConnection(fn) {
      if (!keptCollectionFile().exists) throw new Refusal(NO_COLLECTION);
      const conn = await SQLite.openDatabaseAsync(keptCollectionFile().name, {}, fileUriToPath(ankiFolder().uri));
      try {
        // Waits out the main connection's brief reads rather than failing; and a rollback journal,
        // as the main connection keeps it (see `attach`).
        await conn.execAsync('PRAGMA busy_timeout = 5000');
        await conn.execAsync('PRAGMA journal_mode = DELETE');
        const p = (params: SqlValue[]) => params as SQLite.SQLiteBindValue[];
        return await fn({
          all: (sql, ...params) => conn.getAllAsync(sql, p(params)),
          first: (sql, ...params) => conn.getFirstAsync(sql, p(params)),
          run: async (sql, ...params) => { await conn.runAsync(sql, p(params)); },
          transaction: (work) => conn.withTransactionAsync(work),
        });
      } finally {
        await conn.closeAsync();
      }
    },

    mediaSyncState() {
      return {
        lastUsn: async () => Number(await getSetting(SYNC.mediaUsn) ?? 0),
        setLastUsn: (usn) => setSetting(SYNC.mediaUsn, String(usn)).then(() => undefined),
        recorded: async (name) => (await db.getFirstAsync<{ sha1: string }>('SELECT sha1 FROM anki_media WHERE name = ?', name))?.sha1,
        record: async (name, sha1) => {
          if (sha1) await db.runAsync('INSERT OR REPLACE INTO anki_media (name, sha1) VALUES (?, ?)', name, sha1);
          else await db.runAsync('DELETE FROM anki_media WHERE name = ?', name);
        },
        pending: async () => new Map((await db.getAllAsync<{ name: string; sha1: string }>('SELECT name, sha1 FROM anki_media_pending')).map((r) => [r.name, r.sha1])),
        setPending: async (name, sha1) => {
          if (sha1) await db.runAsync('INSERT OR REPLACE INTO anki_media_pending (name, sha1) VALUES (?, ?)', name, sha1);
          else await db.runAsync('DELETE FROM anki_media_pending WHERE name = ?', name);
        },
      };
    },

    async forgetMediaSync() {
      await db.runAsync('DELETE FROM anki_media');
      await db.runAsync('DELETE FROM settings WHERE key = ?', SYNC.mediaUsn);
    },

    async syncSettings() {
      return {
        enabled: (await getSetting(SYNC.enabled)) === '1',
        server: (await getSetting(SYNC.server)) ?? '',
        user: (await getSetting(SYNC.user)) ?? '',
        lastSyncAt: await getSetting(SYNC.lastSyncAt),
        lastError: await getSetting(SYNC.lastError),
      };
    },

    async saveSyncSettings(patch) {
      for (const [k, v] of Object.entries(patch) as [keyof SyncSettings, SyncSettings[keyof SyncSettings]][]) {
        const key = SYNC[k];
        if (v === null) await db.runAsync('DELETE FROM settings WHERE key = ?', key);
        else await setSetting(key, typeof v === 'boolean' ? (v ? '1' : '0') : v);
      }
    },
  };
  return link;
}
