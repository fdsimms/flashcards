import * as SQLite from 'expo-sqlite';
import { inSchema, keptSql, stripUnicaseIn } from '../anki/attachedSql';
import { COLLECTION_QUERIES, type CollectionRows } from '../anki/collection';
import { ankiFolder, keptCollectionFile, pathOf, workFolder } from '../anki/files';
import {
  cardRestoreParams, cardUpdate, cardUpdateParams, nextRevlogId, previewReturn, revlogEntry, revlogParams, type AnkiCardRow, type AnkiUndo,
} from '../anki/writeback';
import type { SqlValue, SyncDb } from '../anki/sync/collectionSync';
import type { MediaState } from '../anki/sync/mediaSync';
import type { RatingValue } from '../core/scheduler';
import type { RevlogRow } from '../core/stats';
import type { Card } from '../core/types';
import { File } from 'expo-file-system';
import { fileUriToPath } from './backup';

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
  /** A collection's rows for the importer, read from a scratch copy (the original is untouched). */
  readAnkiRows(collection: File): Promise<CollectionRows>;
  /** Makes `collection` the one Franki keeps (it's moved, not copied), replacing any before it. */
  keepAnkiCollection(collection: File): Promise<void>;
  /** Writes an answer into the kept collection. Undefined when the card isn't from it. */
  writeAnkiAnswer(a: {
    before: Card; after: Card; rating: RatingValue; now: Date; takenMs: number; desiredRetention?: number;
    /** The card's deck's step counts, for Anki's `left`. */
    steps?: { learn: number; relearn: number };
    /** Answered in a filtered deck that doesn't reschedule: the card goes home unchanged (`previewReturn`). */
    preview?: boolean;
    /** Siblings to bury with the answer (`siblingsToBury`), in the same transaction. */
    bury?: Card[];
  }): Promise<AnkiUndo | undefined>;
  /**
   * Takes an answer back out of the kept collection. False, changing nothing, when it was already
   * synced (or the collection was replaced since): it's in the server's history, so as in Anki,
   * undo stops at the last sync.
   */
  undoAnkiAnswer(u: AnkiUndo): Promise<boolean>;
  /** The kept collection's file, ready to pack, or null without one. */
  keptCollection(): Promise<File | null>;
  markSentToAnki(): Promise<void>;
  /** The kept collection's review log from `since` on: Anki's whole history plus Franki's answers (for stats). */
  ankiReviewLog(since: Date): Promise<RevlogRow[]>;
  /** For backup and restore, which carry the kept collection: let go of the file, and take it back. */
  detachAnki(): Promise<void>;
  attachAnki(): Promise<void>;

  /**
   * Runs `fn` with the kept collection to itself: answer and undo writes wait until it's done.
   * A sync and an import of a whole collection hold it.
   */
  lockAnki<T>(fn: () => Promise<T>): Promise<T>;
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

export function makeAnkiLink(db: SQLite.SQLiteDatabase): AnkiLink {
  let attached = false;
  // One holder of the kept collection at a time, in the order they asked.
  let queue: Promise<unknown> = Promise.resolve();
  const lockAnki = <T,>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  const getSetting = async (key: string) =>
    (await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key))?.value ?? null;
  const setSetting = (key: string, value: string) =>
    db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', key, value);

  const attach = async () => {
    if (attached || !keptCollectionFile().exists) return;
    await db.runAsync('ATTACH DATABASE ? AS anki', pathOf(keptCollectionFile()));
    // A rollback journal rather than WAL: after every write the file on disk is complete, so it
    // can be packed or backed up without a checkpoint. Anki turns WAL back on when it opens it.
    await db.execAsync('PRAGMA anki.journal_mode = DELETE');
    attached = true;
  };
  const detach = async () => {
    if (!attached) return;
    await db.execAsync('DETACH DATABASE anki');
    attached = false;
  };

  const link: AnkiLink = {
    async ankiStatus() {
      await attach();
      if (!attached) return { linked: false, unsent: 0, lastSentAt: null };
      const since = Number(await getSetting(SETTING.lastSentId) ?? 0);
      const r = await db.getFirstAsync<{ n: number }>(SQL.unsentSince, since);
      return { linked: true, unsent: r?.n ?? 0, lastSentAt: await getSetting(SETTING.lastSentAt) };
    },

    async readAnkiRows(collection) {
      const scratch = new File(workFolder('anki-read'), 'scratch.anki2');
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
        await db.execAsync('DETACH DATABASE scratch');
      }
      // Attached again so SQLite reads the edited schema.
      await db.runAsync('ATTACH DATABASE ? AS scratch', p);
      try {
        const all = <T,>(sql: string) => db.getAllAsync<T>(inSchema(sql, 'scratch'));
        return {
          col: (await db.getFirstAsync<{ crt: number }>(inSchema(COLLECTION_QUERIES.col, 'scratch')))!,
          notetypes: await all(COLLECTION_QUERIES.notetypes),
          fields: await all(COLLECTION_QUERIES.fields),
          templates: await all(COLLECTION_QUERIES.templates),
          notes: await all(COLLECTION_QUERIES.notes),
          cards: await all(COLLECTION_QUERIES.cards),
          decks: await all(COLLECTION_QUERIES.decks),
          deckConfigs: await all(COLLECTION_QUERIES.deckConfigs),
          lastReviews: await all(COLLECTION_QUERIES.lastReviews),
        } as CollectionRows;
      } finally {
        await db.execAsync('DETACH DATABASE scratch');
        scratch.delete();
      }
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

    writeAnkiAnswer: ({ before, after, rating, now, takenMs, desiredRetention, steps, preview, bury = [] }) => lockAnki(async () => {
      await attach();
      if (!attached || !before.ankiId) return undefined;
      const cid = Number(before.ankiId);
      const row = await db.getFirstAsync<AnkiCardRow & { mod: number; usn: number }>(SQL.cardRow, cid);
      if (!row) return undefined; // the card isn't in this collection (it came from an older one)
      const crt = (await db.getFirstAsync<{ crt: number }>(SQL.crt))!.crt;
      const latest = await db.getFirstAsync<{ m: number | null }>(SQL.maxRevlogId);
      const revlogId = nextRevlogId(now.getTime(), latest?.m ?? null);
      const buried: AnkiUndo['buried'] = [];
      for (const s of bury) {
        const sibling = s.ankiId ? await db.getFirstAsync<AnkiCardRow & { mod: number; usn: number }>(SQL.cardRow, Number(s.ankiId)) : null;
        if (sibling) buried.push({ cid: Number(s.ankiId), row: sibling });
      }
      await db.withTransactionAsync(async () => {
        const update = preview ? previewReturn(row, now) : cardUpdate(after, row, { crt, now, desiredRetention, steps });
        await db.runAsync(SQL.cardUpdate, ...cardUpdateParams(update, cid));
        const entry = revlogEntry(before, after, rating, { id: revlogId, cid, previousIvl: row.ivl, now, takenMs, crt });
        // A preview is logged as Anki logs one: kind 3 (filtered), with no change of interval.
        await db.runAsync(SQL.revlogInsert, ...revlogParams(preview ? { ...entry, type: 3, ivl: row.ivl, lastIvl: row.ivl } : entry));
        for (const b of buried) await db.runAsync(SQL.buryCard, Math.floor(now.getTime() / 1000), b.cid);
        await db.runAsync(SQL.colModified, now.getTime());
      });
      return { cid, row, revlogId, buried };
    }),

    undoAnkiAnswer: (u) => lockAnki(async () => {
      await attach();
      if (!attached) return false;
      // Checked under the lock, so a sync can't send the answer between this check and the undo.
      const r = await db.getFirstAsync<{ usn: number }>(SQL.revlogUsn, u.revlogId);
      if (!r || r.usn !== -1) return false;
      await db.withTransactionAsync(async () => {
        await db.runAsync(SQL.cardUpdate, ...cardRestoreParams(u.row, u.cid));
        for (const b of u.buried) await db.runAsync(SQL.cardUpdate, ...cardRestoreParams(b.row, b.cid));
        await db.runAsync(SQL.revlogDelete, u.revlogId);
        await db.runAsync(SQL.colModified, Date.now());
      });
      return true;
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

    detachAnki: detach,
    attachAnki: attach,

    lockAnki,

    async withSyncConnection(fn) {
      if (!keptCollectionFile().exists) throw new Error('There is no Anki collection in Franki yet.');
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
