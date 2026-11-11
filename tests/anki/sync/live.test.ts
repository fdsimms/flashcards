import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildExport } from '../../../src/anki/collection';
import { SyncClient } from '../../../src/anki/sync/client';
import {
  downloadCollection, markDownloaded, prepareForUpload, syncCollection, uploadCollection,
} from '../../../src/anki/sync/collectionSync';
import { pullMedia, type MediaState } from '../../../src/anki/sync/mediaSync';
import { addAnkiNote, ankiDeckId, ankiNoteType, deleteAnkiNotes, editAnkiNote, moveAnkiNote } from '../../../src/anki/noteWrites';
import {
  CARD_ROW_SQL, CARD_UPDATE_SQL, COL_MODIFIED_SQL, REVLOG_INSERT_SQL, cardUpdate, cardUpdateParams, nextRevlogId, revlogEntry, revlogParams,
} from '../../../src/anki/writeback';
import { review } from '../../../src/core/scheduler';
import type { Card } from '../../../src/core/types';
import { importAnkiJson } from '../../../src/import/ankiJson';
import { ANKI_PYTHON, ankiDevice, ankiIntegrity, startAnkiServer, type AnkiServer } from '../../support/ankiServer';
import { readCollectionRows } from '../../support/ankiRows';
import { nodePost, nodeSyncDb } from '../../support/syncDb';
import { sqliteWithUnicase, unicaseExtension } from '../../support/unicase';

/**
 * Franki's sync against Anki's real sync server, with Anki's own client (sync-device.py) on two
 * more devices: "desktop", where changes are made, and "phone", which takes them in by sync as
 * Franki does. After each step Franki has to hold exactly the rows Anki's own merge left on the
 * phone, every table, and its collection has to pass Anki's integrity check.
 *
 * Twice: with Anki's collation (a build with modules/anki-unicase), where decks, deck options,
 * note types and tags are merged in place, and without it (an older build), where those changes
 * end in a full download.
 *
 * Needs the `anki` Python package: FRANKI_ANKI_PYTHON=<venv>/bin/python npx vitest run
 * tests/anki/sync/live.test.ts. Skipped otherwise (CI doesn't have it).
 */

const FIXTURE = join(__dirname, '..', '..', 'fixtures', 'anki', 'collection.anki2');

function franki(server: AnkiServer, collated: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'franki-'));
  const kept = join(dir, 'collection.anki2');
  copyFileSync(FIXTURE, kept);
  const mediaDir = join(dir, 'media');
  let hkey = '';
  const media = new Map<string, string>();
  let mediaUsn = 0;
  const client = () => new SyncClient(server.url, hkey, nodePost);
  const withDb = async <T,>(fn: (db: Awaited<ReturnType<typeof nodeSyncDb>>) => Promise<T>) => {
    const db = await nodeSyncDb(kept, { unicase: collated });
    try { return await fn(db); } finally { db.close(); }
  };
  return {
    kept,
    async login() { hkey = await SyncClient.login(server.url, 'user', 'pass', nodePost); },
    sync: () => withDb((db) => syncCollection(db, client())),
    async download() {
      const parts: Uint8Array[] = [];
      await downloadCollection(client(), (c) => { parts.push(c); });
      writeFileSync(kept, Buffer.concat(parts));
      await withDb(markDownloaded);
    },
    async upload() {
      await withDb((db) => prepareForUpload(db));
      await uploadCollection(client(), new Uint8Array(readFileSync(kept)));
    },
    /** Answers one card the way the Review screen does (writeback.ts), on the kept collection. */
    async answer(pick: (c: Card) => boolean, rating: 1 | 2 | 3 | 4, now = new Date()) {
      const cards = importAnkiJson(buildExport(await readCollectionRows(kept))).cards;
      const before = cards.find(pick)!;
      const after: Card = { ...before, sched: review(before.sched, rating, now).sched };
      const cid = Number(before.ankiId);
      return withDb(async (db) => {
        const row = (await db.first<any>(CARD_ROW_SQL, cid))!;
        const crt = (await db.first<{ crt: number }>('SELECT crt FROM col'))!.crt;
        const id = nextRevlogId(now.getTime(), (await db.first<{ m: number }>('SELECT MAX(id) AS m FROM revlog'))!.m);
        await db.transaction(async () => {
          await db.run(CARD_UPDATE_SQL, ...cardUpdateParams(cardUpdate(after, row, { crt, now }), cid));
          await db.run(REVLOG_INSERT_SQL, ...revlogParams(revlogEntry(before, after, rating, { id, cid, previousIvl: row.ivl, now, takenMs: 4000 })));
          await db.run(COL_MODIFIED_SQL, now.getTime());
        });
        return { cid, revlogId: id };
      });
    },
    async pullMedia(serverMediaUsn: number) {
      mkdirSync(mediaDir, { recursive: true });
      const state: MediaState = {
        lastUsn: async () => mediaUsn,
        setLastUsn: async (u) => { mediaUsn = u; },
        recorded: async (n) => media.get(n),
        record: async (n, s) => { if (s) media.set(n, s); else media.delete(n); },
      };
      return pullMedia(client(), state, {
        exists: (n) => existsSync(join(mediaDir, n)),
        write: async (n, b) => writeFileSync(join(mediaDir, n), b),
        remove: (n) => rmSync(join(mediaDir, n)),
      }, serverMediaUsn);
    },
    mediaFile: (n: string) => readFileSync(join(mediaDir, n), 'utf8'),
    /** Adds, edits and deletes notes as the note editor does (noteWrites.ts). */
    async editNotes() {
      return withDb(async (db) => {
        const now = new Date();
        const reversed = (await ankiNoteType(db, 'Basic (and reversed card)', ['Front', 'Back']))!;
        const deckId = (await ankiDeckId(db, '🧠 Trivia'))!;
        const added = await addAnkiNote(db, { noteType: reversed, deckId, fields: { Front: 'Capital of Uruguay?', Back: 'Montevideo' }, tags: ['geo::south-america', 'franki'], ords: [0, 1], now });
        const grown = await addAnkiNote(db, { noteType: reversed, deckId, fields: { Front: 'Capital of Paraguay?', Back: '' }, tags: [], ords: [0], now });
        await editAnkiNote(db, { nid: grown.nid, noteType: reversed, fields: { Front: 'Capital of Paraguay?', Back: 'Asunción' }, tags: ['geo'], ords: [0, 1], now });
        const victim = (await db.first<{ id: number }>("SELECT id FROM notes WHERE flds LIKE 'Capital of Bolivia?%'"))!.id;
        await deleteAnkiNotes(db, [victim], now);
        const moved = (await db.first<{ id: number }>("SELECT id FROM notes WHERE flds LIKE 'Capital of Chile?%'"))!.id;
        await moveAnkiNote(db, moved, (await ankiDeckId(db, '👅 Languages'))!, now);
        return { added: added.nid, grown: grown.nid, deleted: victim };
      });
    },
    /** The rows sync-device.py's dump returns, read with Node's SQLite and Anki's collation. */
    async dump() {
      const db = await sqliteWithUnicase(kept);
      try {
        const rows = (sql: string) => db.prepare(sql).all() as Record<string, any>[];
        const b64 = (v: Uint8Array) => Buffer.from(v).toString('base64');
        return {
          cards: rows('SELECT * FROM cards ORDER BY id').map((r) => Object.values(r)),
          notes: rows('SELECT id, guid, mid, mod, usn, tags, flds, sfld, csum FROM notes ORDER BY id').map((r) => Object.values(r)),
          revlog: rows('SELECT * FROM revlog ORDER BY id').map((r) => Object.values(r)),
          decks: rows('SELECT id, name, mtime_secs, usn, common, kind FROM decks ORDER BY id').map((r) => [r.id, r.name, r.mtime_secs, r.usn, b64(r.common), b64(r.kind)]),
          deck_config: rows('SELECT id, name, mtime_secs, usn, config FROM deck_config ORDER BY id').map((r) => [r.id, r.name, r.mtime_secs, r.usn, b64(r.config)]),
          notetypes: rows('SELECT id, name, mtime_secs, usn, config FROM notetypes ORDER BY id').map((r) => [r.id, r.name, r.mtime_secs, r.usn, b64(r.config)]),
          fields: rows('SELECT ntid, ord, name, config FROM fields ORDER BY ntid, ord').map((r) => [r.ntid, r.ord, r.name, b64(r.config)]),
          templates: rows('SELECT ntid, ord, name, mtime_secs, usn, config FROM templates ORDER BY ntid, ord').map((r) => [r.ntid, r.ord, r.name, r.mtime_secs, r.usn, b64(r.config)]),
          tags: rows('SELECT tag, usn, collapsed FROM tags ORDER BY tag').map((r) => [r.tag, r.usn, r.collapsed]),
        };
      } finally {
        db.close();
      }
    },
  };
}

type Dump = Record<string, unknown[][]>;

/**
 * Card data JSON compared as values: Anki rewrites it with its own key order and number format.
 * A tag's usn is left out: a device registers a new tag with the server's usn at its own sync,
 * so it differs from one device to the next by Anki's own rule.
 */
function normalized(d: Dump, tables: string[]) {
  const out: Record<string, unknown> = {};
  for (const t of tables) {
    out[t] = t === 'cards' ? d.cards.map((c) => [...c.slice(0, 17), c[17] ? JSON.parse(String(c[17])) : {}])
      : t === 'tags' ? d.tags.map(([tag, , collapsed]) => [tag, collapsed])
        : d[t];
  }
  return out;
}

const ALL = ['cards', 'notes', 'revlog', 'decks', 'deck_config', 'notetypes', 'fields', 'templates', 'tags'];

for (const collated of [true, false]) {
  const run = !!ANKI_PYTHON && !!unicaseExtension();
  // In order: each step builds on the last. CI runs the suite shuffled, but skips this file.
  describe.skipIf(!run)(`sync with a real Anki server, ${collated ? 'with' : 'without'} Anki's collation`, { shuffle: false }, () => {
    let server: AnkiServer;
    let desktop: ReturnType<typeof ankiDevice>;
    let phone: ReturnType<typeof ankiDevice>;
    let me: ReturnType<typeof franki>;
    /** The phone takes in the same changes; Franki then holds exactly its rows, and passes Anki's check. */
    const expectSame = async (tables = ALL) => {
      phone.run('sync');
      expect(normalized(await me.dump(), tables)).toEqual(normalized(phone.run('dump').dump as Dump, tables));
      expect(ankiIntegrity(me.kept)).toEqual(['ok']);
    };

    beforeAll(async () => {
      server = await startAnkiServer();
      desktop = ankiDevice(server, 'desktop');
      desktop.run('upload');
      phone = ankiDevice(server, 'phone');
      phone.run('download');
      me = franki(server, collated);
      await me.login();
    }, 60000);
    afterAll(() => server?.stop());

    it('refuses a wrong password', async () => {
      await expect(SyncClient.login(server.url, 'user', 'nope', nodePost)).rejects.toMatchObject({ kind: 'auth' });
    });

    it('asks for a full sync the first time, and the download is the server\'s collection', async () => {
      expect(await me.sync()).toMatchObject({ kind: 'fullSyncRequired', reason: 'schema', downloadOk: true });
      await me.download();
      expect(await me.sync()).toMatchObject({ kind: 'noChanges' });
      await expectSame();
    });

    it('takes in reviews, a new note and deck counts from Anki', async () => {
      const out = desktop.run('study', '2', '+', 'add-note', 'Default', '<b>caf&eacute;</b> &amp; more', 'back', '+', 'sync');
      expect(out.studied.length).toBeGreaterThan(0);
      expect(await me.sync()).toMatchObject({ kind: 'synced', received: true, sent: 0 });
      await expectSame();
    });

    it('sends its own answers, which Anki then has exactly', async () => {
      const { revlogId } = await me.answer((c) => c.sched.state === 0 && !c.suspended, 3);
      expect(await me.sync()).toMatchObject({ kind: 'synced', sent: 1 });
      desktop.run('sync');
      await expectSame();
      expect((desktop.run('dump').dump.revlog as number[][]).map((r) => r[0])).toContain(revlogId);
    });

    it('when both answered, keeps both reviews and the newer card', async () => {
      await me.answer((c) => c.sched.state !== 0 && !c.suspended, 1, new Date(Date.now() - 60_000));
      desktop.run('study', '1', '+', 'sync');
      expect((await me.sync()).kind).toBe('synced');
      desktop.run('sync');
      await expectSame();
    });

    it('removes what Anki deleted', async () => {
      desktop.run('add-note', 'Default', 'short-lived', 'x', '+', 'sync');
      await me.sync();
      const gone = desktop.run('delete-note', 'short-lived', '+', 'sync').deleted as number[];
      expect(gone).toHaveLength(1);
      expect(await me.sync()).toMatchObject({ kind: 'synced', received: true });
      await expectSame();
      expect((await me.dump()).notes.map((n) => n[0])).not.toContain(gone[0]);
    });

    it('sends notes added, edited, moved and deleted in Franki, which Anki then has exactly', async () => {
      const { added, grown, deleted } = await me.editNotes();
      expect(await me.sync()).toMatchObject({ kind: 'synced', sent: 0 });
      desktop.run('sync');
      await expectSame();
      const theirs = phone.run('dump').dump as Dump;
      const nids = theirs.notes.map((n) => n[0]);
      expect(nids).toContain(added);
      expect(nids).not.toContain(deleted);
      expect(theirs.cards.filter((c) => c[1] === grown).map((c) => c[3])).toEqual([0, 1]);
      if (collated) expect(theirs.tags.map((t) => t[0])).toEqual(expect.arrayContaining(['franki', 'geo::south-america']));
    });

    it(collated
      ? 'merges new, renamed and deleted decks, deck options, note types and tags in place'
      : 'sends its answers first, then downloads, when Anki changed decks, options, note types or tags', async () => {
      const { revlogId } = await me.answer((c) => c.sched.state === 0 && !c.suspended, 3);
      desktop.run(
        'rename-deck', 'Default', 'Renamed', '+', 'add-deck', 'Polski::Odmiana', '+',
        'add-note', 'Polski::Odmiana', 'kot', 'cat', 'polski Polski::rzeczowniki', '+',
        'set-new-per-day', 'Renamed', '7', '+', 'edit-template', 'Basic', '<hr>', '+',
        'delete-deck', 'Filtered Deck 1', '+', 'sync',
      );
      const r = await me.sync();
      if (collated) {
        expect(r).toMatchObject({ kind: 'synced', received: true, sent: 1 });
      } else {
        expect(r).toMatchObject({ kind: 'downloadNeeded', sent: 1 });
        await me.download();
      }
      expect(await me.sync()).toMatchObject({ kind: 'noChanges' });
      desktop.run('sync');
      await expectSame();
      expect((await me.dump()).revlog.map((row) => row[0])).toContain(revlogId);
    });

    it('asks which collection to keep after a note type gained a field, as Anki does', async () => {
      // Adding a field is a schema change: Anki makes that device upload, and every other one
      // then has to replace its collection one way or the other.
      await me.answer((c) => c.sched.state === 0 && !c.suspended, 3);
      expect(desktop.run('add-field', 'Basic', 'Notes', '+', 'sync').sync.required).not.toBe(0);
      desktop.run('upload');
      expect(await me.sync()).toMatchObject({ kind: 'fullSyncRequired', reason: 'schema', uploadOk: true, downloadOk: true });
      await me.download();
      phone.run('download');
      await expectSame();
    });

    it('can replace the server\'s collection with its own', async () => {
      await me.answer((c) => c.sched.state === 0 && !c.suspended, 4);
      await me.upload();
      expect(desktop.run('sync').sync.required).not.toBe(0);
      desktop.run('download');
      phone.run('download');
      // The server opens and re-stamps an uploaded collection, so one ordinary sync may follow.
      const after = await me.sync();
      expect(after.kind === 'noChanges' || (after.kind === 'synced' && after.sent === 0)).toBe(true);
      await expectSame();
    });

    it('downloads media Anki added', async () => {
      const name = desktop.run('add-media', 'franki-test.txt', 'hello from anki', '+', 'sync', '+', 'media-sync').media;
      const r = await me.sync();
      if (r.kind === 'downloadNeeded') await me.download();
      expect(r.kind === 'synced' || r.kind === 'downloadNeeded').toBe(true);
      const pulled = await me.pullMedia(r.mediaUsn);
      expect(pulled.downloaded).toBeGreaterThan(0);
      expect(me.mediaFile(name)).toBe('hello from anki');
    });
  });
}
