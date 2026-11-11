import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildExport } from '../../../src/anki/collection';
import { SyncClient } from '../../../src/anki/sync/client';
import {
  downloadCollection, markDownloaded, prepareForUpload, syncCollection, uploadCollection, type SyncOutcome,
} from '../../../src/anki/sync/collectionSync';
import { pullMedia, type MediaState } from '../../../src/anki/sync/mediaSync';
import {
  CARD_ROW_SQL, CARD_UPDATE_SQL, COL_MODIFIED_SQL, REVLOG_INSERT_SQL, cardUpdate, cardUpdateParams, nextRevlogId, revlogEntry, revlogParams,
} from '../../../src/anki/writeback';
import { review } from '../../../src/core/scheduler';
import type { Card } from '../../../src/core/types';
import { importAnkiJson } from '../../../src/import/ankiJson';
import { ANKI_PYTHON, ankiDevice, startAnkiServer, type AnkiServer } from '../../support/ankiServer';
import { readCollectionRows } from '../../support/ankiRows';
import { nodePost, nodeSyncDb } from '../../support/syncDb';

/**
 * Franki's sync against Anki's real sync server, with Anki's own client (sync-device.py) as the
 * other device, checking after each step that both hold the same rows. Needs the `anki` Python
 * package: FRANKI_ANKI_PYTHON=<venv>/bin/python npx vitest run tests/anki/sync/live.test.ts.
 * Skipped otherwise (CI doesn't have it).
 */

function franki(server: AnkiServer) {
  const dir = mkdtempSync(join(tmpdir(), 'franki-'));
  const kept = join(dir, 'collection.anki2');
  copyFileSync(join(__dirname, '..', '..', 'fixtures', 'anki', 'collection.anki2'), kept);
  const mediaDir = join(dir, 'media');
  let hkey = '';
  const media = new Map<string, string>();
  let mediaUsn = 0;
  const client = () => new SyncClient(server.url, hkey, nodePost);
  const withDb = async <T,>(fn: (db: Awaited<ReturnType<typeof nodeSyncDb>>) => Promise<T>) => {
    const db = await nodeSyncDb(kept);
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
      const { mkdirSync } = await import('node:fs');
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
    /** The same rows sync-device.py's dump returns, read with Node's SQLite. */
    async dump() {
      return withDb(async (db) => {
        const arrays = (rows: Record<string, unknown>[]) => rows.map((r) => Object.values(r));
        return {
          cards: arrays(await db.all('SELECT * FROM cards ORDER BY id')),
          notes: arrays(await db.all('SELECT id, guid, mid, mod, usn, tags, flds, sfld, csum FROM notes ORDER BY id')),
          revlog: arrays(await db.all('SELECT * FROM revlog ORDER BY id')),
          decks: (await db.all<any>('SELECT id, name, mtime_secs, usn, common, kind FROM decks NOT INDEXED ORDER BY id'))
            .map((r) => [r.id, r.name, r.mtime_secs, r.usn, Buffer.from(r.common).toString('base64'), Buffer.from(r.kind).toString('base64')]),
        };
      });
    },
  };
}

/** Card data JSON compared as values: Anki rewrites it with its own key order and number format. */
function normalized(d: { cards: unknown[][]; notes: unknown[][]; revlog: unknown[][]; decks: unknown[][] }) {
  return {
    ...d,
    cards: d.cards.map((c) => [...c.slice(0, 17), c[17] ? JSON.parse(String(c[17])) : {}]),
  };
}

// In order: each step builds on the last. CI runs the suite shuffled, but skips this file.
describe.skipIf(!ANKI_PYTHON)('sync with a real Anki server', { shuffle: false }, () => {
  let server: AnkiServer;
  let anki: ReturnType<typeof ankiDevice>;
  let me: ReturnType<typeof franki>;
  const expectSame = async () => {
    const { cards, notes, revlog, decks } = anki.run('dump').dump;
    expect(normalized(await me.dump())).toEqual(normalized({ cards, notes, revlog, decks }));
  };

  beforeAll(async () => {
    server = await startAnkiServer();
    anki = ankiDevice(server, 'desktop');
    anki.run('upload');
    me = franki(server);
    await me.login();
  }, 30000);
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

  it('takes in reviews, a new note and deck counts from Anki, in place', async () => {
    const out = anki.run('study', '2', '+', 'add-note', 'Default', '<b>caf&eacute;</b> &amp; more', 'back', '+', 'sync');
    expect(out.studied.length).toBeGreaterThan(0);
    const r = await me.sync();
    expect(r).toMatchObject({ kind: 'synced', received: true, sent: 0 });
    await expectSame();
  });

  it('sends its own answers, which Anki then has exactly', async () => {
    const { revlogId } = await me.answer((c) => c.sched.state === 0 && !c.suspended, 3);
    expect(await me.sync()).toMatchObject({ kind: 'synced', sent: 1 });
    anki.run('sync');
    await expectSame();
    expect(anki.run('dump').dump.revlog.map((r: number[]) => r[0])).toContain(revlogId);
  });

  it('removes what Anki deleted', async () => {
    anki.run('add-note', 'Default', 'short-lived', 'x', '+', 'sync');
    await me.sync();
    const gone = anki.run('delete-note', 'short-lived', '+', 'sync').deleted as number[];
    expect(gone).toHaveLength(1);
    expect(await me.sync()).toMatchObject({ kind: 'synced', received: true });
    await expectSame();
    expect((await me.dump()).notes.map((n) => n[0])).not.toContain(gone[0]);
  });

  it('when both answered, keeps both reviews and the newer card', async () => {
    await me.answer((c) => c.sched.state !== 0 && !c.suspended, 1, new Date(Date.now() - 60_000));
    anki.run('study', '1', '+', 'sync');
    expect((await me.sync()).kind).toBe('synced');
    anki.run('sync');
    await expectSame();
  });

  it('sends its answers first, then downloads, when Anki changed what it can\'t write in place', async () => {
    const { revlogId } = await me.answer((c) => c.sched.state === 0 && !c.suspended, 3);
    anki.run('rename-deck', 'Default', 'Renamed', '+', 'add-note', 'Renamed', 'x', 'y', 'brand-new-tag', '+', 'set-new-per-day', 'Renamed', '7', '+', 'sync');
    const r: SyncOutcome = await me.sync();
    expect(r).toMatchObject({ kind: 'downloadNeeded', sent: 1 });
    await me.download();
    expect(await me.sync()).toMatchObject({ kind: 'noChanges' });
    anki.run('sync');
    await expectSame();
    expect((await me.dump()).revlog.map((row) => row[0])).toContain(revlogId);
  });

  it('can replace the server\'s collection with its own', async () => {
    await me.answer((c) => c.sched.state === 0 && !c.suspended, 4);
    await me.upload();
    expect(anki.run('sync').sync.required).not.toBe(0);
    anki.run('download');
    // The server opens and re-stamps an uploaded collection, so one ordinary sync may follow.
    const after = await me.sync();
    expect(after.kind === 'noChanges' || (after.kind === 'synced' && after.sent === 0)).toBe(true);
    await expectSame();
  });

  it('downloads media Anki added', async () => {
    const name = anki.run('add-media', 'franki-test.txt', 'hello from anki', '+', 'sync', '+', 'media-sync').media;
    const r = await me.sync();
    if (r.kind === 'downloadNeeded') await me.download();
    expect(r.kind === 'synced' || r.kind === 'downloadNeeded').toBe(true);
    const pulled = await me.pullMedia((r as { mediaUsn: number }).mediaUsn);
    expect(pulled.downloaded).toBeGreaterThan(0);
    expect(me.mediaFile(name)).toBe('hello from anki');
  });
});
