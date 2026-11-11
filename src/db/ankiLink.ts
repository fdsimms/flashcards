import type * as SQLite from 'expo-sqlite';
import { inSchema, keptSql, stripUnicaseIn } from '../anki/attachedSql';
import { COLLECTION_QUERIES, type CollectionRows } from '../anki/collection';
import { ankiFolder, keptCollectionFile, pathOf, workFolder } from '../anki/files';
import {
  cardRestoreParams, cardUpdate, cardUpdateParams, nextRevlogId, revlogEntry, revlogParams, type AnkiCardRow, type AnkiUndo,
} from '../anki/writeback';
import type { RatingValue } from '../core/scheduler';
import type { Card } from '../core/types';
import { File } from 'expo-file-system';

/**
 * The Anki collection Franki keeps (Documents/anki/collection.anki2), attached to the app's one
 * SQLite connection as `anki`. Imported from Anki whole, written to on every answer, and packed
 * back up for Anki on "Send to Anki". It's never edited except through `cards` and `revlog`,
 * whose columns use no custom collation, so it stays exactly the file Anki wrote plus Franki's
 * answers. Step 2 (syncing) will send the rows these writes mark unsynced (usn -1).
 */

export interface AnkiStatus {
  /** Whether Franki holds an Anki collection at all. */
  linked: boolean;
  /** Answers given in Franki and not yet sent back to Anki. */
  unsent: number;
  lastSentAt: string | null;
}

export type { AnkiUndo };

export interface AnkiLink {
  ankiStatus(): Promise<AnkiStatus>;
  /** A collection's rows for the importer, read from a scratch copy (the original is untouched). */
  readAnkiRows(collection: File): Promise<CollectionRows>;
  /** Makes `collection` the one Franki keeps (it's moved, not copied), replacing any before it. */
  keepAnkiCollection(collection: File): Promise<void>;
  /** Writes an answer into the kept collection. Undefined when the card isn't from it. */
  writeAnkiAnswer(a: { before: Card; after: Card; rating: RatingValue; now: Date; takenMs: number; desiredRetention?: number }): Promise<AnkiUndo | undefined>;
  undoAnkiAnswer(u: AnkiUndo): Promise<void>;
  /** The kept collection's file, ready to pack, or null without one. */
  keptCollection(): Promise<File | null>;
  markSentToAnki(): Promise<void>;
  /** For backup and restore, which carry the kept collection: let go of the file, and take it back. */
  detachAnki(): Promise<void>;
  attachAnki(): Promise<void>;
}

const SETTING = { lastSentId: 'anki_last_sent_revlog_id', lastSentAt: 'anki_last_sent_at' };
/** The settings that belong to the kept collection, and so travel with it in a backup. */
export const ANKI_SETTING_KEYS = Object.values(SETTING);

const SQL = keptSql('anki');

export function makeAnkiLink(db: SQLite.SQLiteDatabase): AnkiLink {
  let attached = false;

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

    async writeAnkiAnswer({ before, after, rating, now, takenMs, desiredRetention }) {
      await attach();
      if (!attached || !before.ankiId) return undefined;
      const cid = Number(before.ankiId);
      const row = await db.getFirstAsync<AnkiCardRow & { mod: number; usn: number }>(SQL.cardRow, cid);
      if (!row) return undefined; // the card isn't in this collection (it came from an older one)
      const crt = (await db.getFirstAsync<{ crt: number }>(SQL.crt))!.crt;
      const latest = await db.getFirstAsync<{ m: number | null }>(SQL.maxRevlogId);
      const revlogId = nextRevlogId(now.getTime(), latest?.m ?? null);
      await db.withTransactionAsync(async () => {
        await db.runAsync(SQL.cardUpdate, ...cardUpdateParams(cardUpdate(after, row, { crt, now, desiredRetention }), cid));
        await db.runAsync(SQL.revlogInsert, ...revlogParams(revlogEntry(before, after, rating, { id: revlogId, cid, previousIvl: row.ivl, now, takenMs })));
      });
      return { cid, row, revlogId };
    },

    async undoAnkiAnswer(u) {
      await attach();
      if (!attached) return;
      await db.withTransactionAsync(async () => {
        await db.runAsync(SQL.cardUpdate, ...cardRestoreParams(u.row, u.cid));
        await db.runAsync(SQL.revlogDelete, u.revlogId);
      });
    },

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

    detachAnki: detach,
    attachAnki: attach,
  };
  return link;
}
