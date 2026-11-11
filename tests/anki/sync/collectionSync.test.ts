import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SyncClient, type HttpPost } from '../../../src/anki/sync/client';
import { prepareForUpload, syncCollection } from '../../../src/anki/sync/collectionSync';
import type { CardEntry, SyncMeta } from '../../../src/anki/sync/protocol';
import { zstdUnwrap, zstdWrap } from '../../../src/anki/zstd';
import { nodeSyncDb } from '../../support/syncDb';

/**
 * The sync's decisions against a scripted server, so CI covers them without Anki. That the
 * requests and replies are what Anki's server really sends and expects is live.test.ts's job.
 */

const FIXTURE = join(__dirname, '..', '..', 'fixtures', 'anki', 'collection.anki2');
const NOW = 1_800_000_000_000;

type Handler = (body: any) => unknown;

function fakeServer(routes: Record<string, Handler>) {
  const calls: { path: string; body: any }[] = [];
  const post: HttpPost = async (url, headers, body) => {
    const path = url.replace('https://anki.example/', '');
    const json = JSON.parse(new TextDecoder().decode(zstdUnwrap(body)));
    calls.push({ path, body: json });
    expect(JSON.parse(headers['anki-sync'])).toMatchObject({ v: 11, k: 'hkey' });
    const handler = routes[path];
    if (!handler) throw new Error(`unexpected ${path}`);
    let reply: unknown;
    try { reply = handler(json); } catch (e) {
      const text = new TextEncoder().encode(String((e as Error).message));
      let sent = false;
      return { status: 500, read: async () => (sent ? null : ((sent = true), text)) };
    }
    const bytes = zstdWrap(new TextEncoder().encode(JSON.stringify(reply ?? null)));
    let sent = false;
    return { status: 200, read: async () => (sent ? null : ((sent = true), bytes)) };
  };
  return { client: new SyncClient('https://anki.example', 'hkey', post), calls, paths: () => calls.map((c) => c.path) };
}

const opened: { close(): void }[] = [];
afterEach(() => { while (opened.length) opened.pop()!.close(); });

async function collection() {
  const dir = mkdtempSync(join(tmpdir(), 'sync-unit-'));
  const path = join(dir, 'collection.anki2');
  copyFileSync(FIXTURE, path);
  const db = await nodeSyncDb(path);
  opened.push(db);
  // The fixture was never synced, so Anki left everything in it marked as waiting to be sent;
  // after a first (full) sync nothing is.
  for (const t of ['cards', 'notes', 'revlog', 'decks', 'deck_config', 'notetypes']) await db.run(`UPDATE ${t} SET usn = 0 WHERE usn = -1`);
  return db;
}

async function colRow(db: Awaited<ReturnType<typeof collection>>) {
  return (await db.first<{ mod: number; scm: number; usn: number; ls: number }>('SELECT mod, scm, usn, ls FROM col'))!;
}

const meta = (over: Partial<SyncMeta>, col: { mod: number; scm: number }): SyncMeta => ({
  mod: col.mod + 1000, scm: col.scm, usn: 10, ts: NOW / 1000, msg: '', cont: true, hostNum: 0, empty: false, media_usn: 4, ...over,
});

/** A normal sync's replies with nothing in them; override one step at a time. */
function quietRoutes(col: { mod: number; scm: number }, over: Partial<Record<string, Handler>> = {}): Record<string, Handler> {
  return {
    'sync/meta': () => meta({}, col),
    'sync/start': () => ({ cards: [], notes: [], decks: [] }),
    'sync/applyGraves': () => null,
    'sync/applyChanges': () => ({ models: [], decks: [[], []], tags: [] }),
    'sync/chunk': () => ({ done: true }),
    'sync/applyChunk': () => null,
    'sync/sanityCheck2': () => ({ status: 'ok' }),
    'sync/finish': () => NOW + 5,
    'sync/abort': () => null,
    ...over,
  } as Record<string, Handler>;
}

describe('syncing the kept collection', () => {
  it('does nothing when neither side changed', async () => {
    const db = await collection();
    const col = await colRow(db);
    const s = fakeServer({ 'sync/meta': () => meta({ mod: col.mod }, col) });
    expect(await syncCollection(db, s.client, () => NOW)).toEqual({ kind: 'noChanges', mediaUsn: 4 });
    expect(s.paths()).toEqual(['sync/meta']);
  });

  it('asks for a full sync when the server\'s collection has another history', async () => {
    const db = await collection();
    const col = await colRow(db);
    const s = fakeServer({ 'sync/meta': () => meta({ scm: col.scm + 1, empty: true }, col) });
    expect(await syncCollection(db, s.client, () => NOW)).toEqual({ kind: 'fullSyncRequired', uploadOk: true, downloadOk: false, reason: 'schema', mediaUsn: 4 });
  });

  it('refuses when the clock is off, and passes on a server\'s refusal', async () => {
    const db = await collection();
    const col = await colRow(db);
    await expect(syncCollection(db, fakeServer({ 'sync/meta': () => meta({ ts: NOW / 1000 + 600 }, col) }).client, () => NOW))
      .rejects.toMatchObject({ kind: 'clock' });
    await expect(syncCollection(db, fakeServer({ 'sync/meta': () => meta({ cont: false, msg: 'Upgrade the server' }, col) }).client, () => NOW))
      .rejects.toMatchObject({ kind: 'server', message: 'Upgrade the server' });
  });

  it('sends its pending answers, takes the server\'s newer cards, keeps its own newer ones, and finishes', async () => {
    const db = await collection();
    const col = await colRow(db);
    const [mine, theirs] = await db.all<{ id: number; nid: number; mod: number }>('SELECT id, nid, mod FROM cards ORDER BY id LIMIT 2');
    // Franki answered both; the server has a newer version of `theirs` and an older one of `mine`.
    await db.run('UPDATE cards SET usn = -1, mod = ?, reps = 7 WHERE id IN (?, ?)', 1000, mine.id, theirs.id);
    await db.run('INSERT INTO revlog (id, cid, usn, ease, ivl, lastIvl, factor, time, type) VALUES (?, ?, -1, 3, 1, 0, 2500, 3000, 0)', NOW, mine.id);
    const card = (id: number, nid: number, mod: number, reps: number): CardEntry => [id, nid, 1, 0, mod, 9, 2, 2, 100, 5, 2500, reps, 0, 0, 0, 0, 0, '{"s":3.1}'];
    let sentChunk: any;
    let counts: any;
    const s = fakeServer(quietRoutes(col, {
      'sync/chunk': () => ({ done: true, cards: [card(mine.id, mine.nid, 999, 1), card(theirs.id, theirs.nid, 2000, 42)] }),
      'sync/applyChunk': (b) => { sentChunk = b.chunk; return null; },
      'sync/sanityCheck2': (b) => { counts = b.client; return { status: 'ok' }; },
    }));
    const out = await syncCollection(db, s.client, () => NOW);
    expect(out).toEqual({ kind: 'synced', received: true, sent: 1, mediaUsn: 4 });
    expect(s.paths()).toEqual(['sync/meta', 'sync/start', 'sync/applyChanges', 'sync/chunk', 'sync/applyChunk', 'sync/sanityCheck2', 'sync/finish']);
    expect(s.calls[1].body).toEqual({ minUsn: col.usn, lnewer: false });
    // Ours went out marked with the server's usn; theirs replaced the local copy and wasn't sent.
    expect(sentChunk.revlog.map((r: number[]) => [r[0], r[2]])).toEqual([[NOW, 10]]);
    expect(sentChunk.cards.map((c: number[]) => [c[0], c[5], c[11]])).toEqual([[mine.id, 10, 7]]);
    expect((await db.first<{ reps: number; usn: number }>('SELECT reps, usn FROM cards WHERE id = ?', theirs.id))).toEqual({ reps: 42, usn: 9 });
    expect(counts[0]).toEqual([0, 0, 0]);
    expect(await colRow(db)).toMatchObject({ mod: NOW + 5, ls: NOW + 5, usn: 11 });
  });

  it('sends its config when it\'s newer, and takes the server\'s when that is', async () => {
    const db = await collection();
    const col = await colRow(db);
    const newer = fakeServer(quietRoutes(col, { 'sync/meta': () => meta({ mod: col.mod - 1000 }, col) }));
    await syncCollection(db, newer.client, () => NOW);
    const sent = newer.calls.find((c) => c.path === 'sync/applyChanges')!.body.changes;
    expect(sent.conf.rollover).toBe(4);
    expect(sent.crt).toBe((await db.first<{ crt: number }>('SELECT crt FROM col'))!.crt);

    const db2 = await collection();
    const older = fakeServer(quietRoutes(col, {
      'sync/applyChanges': () => ({ models: [], decks: [[], []], tags: [], conf: { rollover: 5, curDeck: 1 }, crt: 1700000000 }),
    }));
    expect(await syncCollection(db2, older.client, () => NOW)).toMatchObject({ kind: 'synced', received: true });
    const rows = await db2.all<{ key: string; val: Uint8Array }>('SELECT KEY AS key, val FROM config ORDER BY KEY');
    expect(rows.map((r) => [r.key, new TextDecoder().decode(r.val)])).toEqual([['curDeck', '1'], ['rollover', '5']]);
  });

  it('finishes, then asks for a download, when the server added a deck it can\'t write here', async () => {
    const db = await collection();
    const col = await colRow(db);
    const decks = (await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM decks NOT INDEXED'))!.n;
    let counts: any;
    const s = fakeServer(quietRoutes(col, {
      'sync/applyChanges': () => ({ models: [], tags: [], decks: [[{ id: 77, name: 'New deck', mod: 1, usn: 10, dyn: 0, conf: 1 }], []] }),
      'sync/sanityCheck2': (b) => { counts = b.client; return { status: 'ok' }; },
    }));
    expect(await syncCollection(db, s.client, () => NOW)).toMatchObject({ kind: 'downloadNeeded', reason: 'a deck was added' });
    expect(counts[6]).toBe(decks + 1);
    expect(s.paths()).toContain('sync/finish');
  });

  it('rolls back and aborts when the counts disagree, and asks for a full sync', async () => {
    const db = await collection();
    const col = await colRow(db);
    const [card] = await db.all<{ id: number }>('SELECT id FROM cards LIMIT 1');
    await db.run('UPDATE cards SET usn = -1 WHERE id = ?', card.id);
    const s = fakeServer(quietRoutes(col, { 'sync/sanityCheck2': () => ({ status: 'bad' }) }));
    expect(await syncCollection(db, s.client, () => NOW)).toMatchObject({ kind: 'fullSyncRequired', reason: 'sanity' });
    expect(s.paths().at(-1)).toBe('sync/abort');
    expect((await db.first<{ usn: number }>('SELECT usn FROM cards WHERE id = ?', card.id))!.usn).toBe(-1);
    expect(await colRow(db)).toEqual(col);
  });

  it('rolls back and aborts when the server fails part way', async () => {
    const db = await collection();
    const col = await colRow(db);
    const s = fakeServer(quietRoutes(col, { 'sync/chunk': () => { throw new Error('disk full'); } }));
    await expect(syncCollection(db, s.client, () => NOW)).rejects.toMatchObject({ kind: 'server', message: '500: disk full' });
    expect(s.paths().at(-1)).toBe('sync/abort');
    expect(await colRow(db)).toEqual(col);
  });

  it('asks for a full sync when the collection has deck changes only an upload can send', async () => {
    const db = await collection();
    const col = await colRow(db);
    await db.run('UPDATE deck_config SET usn = -1');
    const s = fakeServer(quietRoutes(col));
    expect(await syncCollection(db, s.client, () => NOW)).toMatchObject({ kind: 'fullSyncRequired', reason: 'local' });
  });

  it('readies the collection for an upload: nothing pending, and a new schema time', async () => {
    const db = await collection();
    const before = await colRow(db);
    await db.run('UPDATE cards SET usn = -1');
    await db.run('INSERT INTO graves (usn, oid, type) VALUES (-1, 5, 0)');
    await prepareForUpload(db, () => NOW);
    expect((await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM cards WHERE usn = -1'))!.n).toBe(0);
    expect((await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM graves'))!.n).toBe(0);
    expect(await colRow(db)).toMatchObject({ scm: NOW, ls: NOW, usn: before.usn + 1 });
  });
});
