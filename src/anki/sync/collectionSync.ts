import { decodeMessage, uint, utf8Decode, utf8Encode } from '../protobuf';
import type { SyncClient } from './client';
import { deckConfigRow, type DeckConfigJson } from './deckConfigRow';
import { deckRow } from './deckRows';
import { parseJson, stringifyJson } from './json';
import { cleanField, sortFieldAndChecksum } from './noteFields';
import { notetypeRows, type NotetypeJson } from './notetypeRows';
import {
  CHUNK_SIZE, CLIENT_VERSION, SYNC_VERSION, SyncError,
  type CardEntry, type Chunk, type Graves, type NoteEntry, type RevlogEntry, type SanityCounts, type SanityResponse,
  type SyncMeta, type UnchunkedChanges,
} from './protocol';

/**
 * Syncs the Anki collection Franki keeps with an Anki sync server, as an Anki client would: the
 * server's changes come in, Franki's answers (cards and review log rows marked usn -1) go out,
 * and both sides finish with the same rows. The sequence is rslib's `NormalSyncer`
 * (rslib/src/sync/collection/normal.rs): meta, start (deletions), unchunked changes (note types,
 * decks, deck options, tags, config), chunks from the server, chunks to it, sanity check, finish.
 *
 * Anki's collated tables. Decks, deck options, note types and tags are kept under a collation
 * of Anki's own (`unicase`), which an insert, rename or delete on them needs. The app registers
 * it on every connection (modules/anki-unicase), and then a sync writes those rows as Anki's merge
 * does (`collated`). A build without that module can still update an existing deck in place,
 * which covers the usual case (answering in Anki bumps its deck's daily counts); anything else
 * (a new, renamed or deleted deck, changed deck options or note types, a tag) it leaves unwritten,
 * finishes the sync so its answers reach the server, and then asks for a full download. So does
 * a note type whose fields or templates were added or removed, which Anki's own merge refuses.
 * Nothing is lost either way. The sanity check at the end is then answered with the counts Franki
 * would have had after writing those rows, which are the counts it has after the download.
 *
 * Runs on its own connection to the collection, in one transaction: a failure anywhere rolls back
 * every local change and tells the server to abort.
 */

export type SqlValue = string | number | null | Uint8Array;

/** One connection to the kept collection. */
export interface SyncDb {
  all<T>(sql: string, ...params: SqlValue[]): Promise<T[]>;
  first<T>(sql: string, ...params: SqlValue[]): Promise<T | null>;
  run(sql: string, ...params: SqlValue[]): Promise<void>;
  /** Runs `fn` in a transaction, rolled back if it throws. */
  transaction(fn: () => Promise<void>): Promise<void>;
}

/** Every outcome carries `mediaUsn`, the server's media counter, for the media pull that follows. */
export type SyncOutcome = { mediaUsn: number } & (
  /** Nothing had changed on either side. */
  | { kind: 'noChanges' }
  /**
   * Changes went one or both ways. `received`: the collection changed here, so Franki's own tables
   * need refreshing. `sent`: answers (review log rows) sent; their cards went with them.
   */
  | { kind: 'synced'; received: boolean; sent: number }
  /** Franki's changes reached the server, but the server has changes only a full download can bring. */
  | { kind: 'downloadNeeded'; sent: number; reason: string }
  /**
   * The two collections can't be merged: one has to replace the other. `schema`: they have
   * different histories (the server was set up from another copy, or something forced a full
   * sync). `sanity`: their counts disagreed after a sync. `local`: the kept collection has
   * changes to decks or note types (from the app it was exported from) that only an upload sends.
   */
  | { kind: 'fullSyncRequired'; uploadOk: boolean; downloadOk: boolean; reason: 'schema' | 'sanity' | 'local' }
);

const GRAVE = { card: 0, note: 1, deck: 2 } as const;
const NOTETYPE_SORT_FIELD = 2; // Notetype.Config.sort_field_idx

interface Local { mod: number; scm: number; usn: number; crt: number }

export async function localMeta(db: SyncDb): Promise<Local & { empty: boolean }> {
  const col = (await db.first<Local>('SELECT mod, scm, usn, crt FROM col'))!;
  const card = await db.first<{ id: number }>('SELECT id FROM cards LIMIT 1');
  return { ...col, empty: !card };
}

/**
 * Rows of the collated tables marked as changed here, which only a full upload can send. (Tags
 * can't be read at all without the collation; nothing Franki does marks one.)
 */
async function localUnsendable(db: SyncDb): Promise<number> {
  let n = 0;
  for (const t of ['notetypes', 'decks', 'deck_config']) {
    n += (await db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t} WHERE usn = -1`))!.n;
  }
  return n;
}

/** The server's state, for when there's no collection here yet to sync. */
export async function serverMeta(client: SyncClient): Promise<SyncMeta> {
  return client.call<SyncMeta>('sync/meta', { v: SYNC_VERSION, cv: CLIENT_VERSION });
}

export async function syncCollection(db: SyncDb, client: SyncClient, now: () => number = Date.now): Promise<SyncOutcome> {
  const local = await localMeta(db);
  const remote = await serverMeta(client);
  if (!remote.cont) throw new SyncError('server', remote.msg || 'The server refused to sync.');
  if (Math.abs(remote.ts - now() / 1000) > 300) {
    throw new SyncError('clock', "The phone's clock is more than five minutes off the server's. Set it to the correct time and sync again.");
  }
  const mediaUsn = remote.media_usn ?? 0;
  if (remote.mod === local.mod) return { kind: 'noChanges', mediaUsn };
  if (remote.scm !== local.scm) {
    return { kind: 'fullSyncRequired', uploadOk: !local.empty || !!remote.empty, downloadOk: !remote.empty || local.empty, reason: 'schema', mediaUsn };
  }
  if (await localUnsendable(db)) return { kind: 'fullSyncRequired', uploadOk: true, downloadOk: true, reason: 'local', mediaUsn };

  const serverUsn = remote.usn;
  const localIsNewer = local.mod > remote.mod;
  const state = new SyncState(await hasUnicase(db));
  let sent = 0;
  let received = false;

  try {
    await db.transaction(async () => {
      // ---- deletions ----
      const theirGraves = await client.call<Graves>('sync/start', { minUsn: local.usn, lnewer: localIsNewer });
      const ours = await pendingGraves(db);
      for (const chunk of graveChunks(ours)) await client.call('sync/applyGraves', { chunk });
      await db.run('UPDATE graves SET usn = ? WHERE usn = -1', serverUsn);
      received = (await applyGraves(db, theirGraves, serverUsn, state)) || received;

      // ---- unchunked: note types, decks, deck options, tags, config ----
      const mine: UnchunkedChanges = { models: [], decks: [[], []], tags: [] };
      if (localIsNewer) {
        mine.conf = await allConfig(db);
        mine.crt = local.crt;
        await db.run('UPDATE config SET usn = 0 WHERE usn != 0');
      }
      const theirs = await client.call<UnchunkedChanges>('sync/applyChanges', { changes: mine });
      received = (await applyUnchunked(db, theirs, serverUsn, now, state)) || received;

      // ---- chunks from the server ----
      for (;;) {
        const chunk = await client.call<Chunk>('sync/chunk', {});
        received = (await applyChunk(db, chunk, state)) || received;
        if (chunk.done) break;
      }

      // ---- chunks to the server ----
      const ids = {
        revlog: (await db.all<{ id: number }>('SELECT id FROM revlog WHERE usn = -1')).map((r) => r.id),
        cards: (await db.all<{ id: number }>('SELECT id FROM cards WHERE usn = -1')).map((r) => r.id),
        notes: (await db.all<{ id: number }>('SELECT id FROM notes WHERE usn = -1')).map((r) => r.id),
      };
      for (;;) {
        const chunk = await takeChunk(db, ids, serverUsn);
        sent += chunk.revlog?.length ?? 0;
        await client.call('sync/applyChunk', { chunk });
        if (chunk.done) break;
      }

      // ---- sanity check and finish ----
      const counts = await sanityCounts(db, state);
      const check = await client.call<SanityResponse>('sync/sanityCheck2', { client: counts });
      if (check.status !== 'ok') {
        throw new SyncError('sanity', `Franki and the server disagree on what the collection holds (Franki ${JSON.stringify(check.c)}, server ${JSON.stringify(check.s)}).`);
      }
      const newMod = await client.call<number>('sync/finish', {});
      await db.run('UPDATE col SET ls = ?, usn = ?, mod = ?', newMod, serverUsn + 1, newMod);
    });
  } catch (e) {
    try { await client.call('sync/abort', {}); } catch { /* the server drops the sync on its own */ }
    if (e instanceof SyncError && e.kind === 'sanity') return { kind: 'fullSyncRequired', uploadOk: true, downloadOk: true, reason: 'sanity', mediaUsn };
    throw e;
  }

  if (state.needsDownload.length) return { kind: 'downloadNeeded', sent, mediaUsn, reason: state.needsDownload.join('; ') };
  return { kind: 'synced', received, sent, mediaUsn };
}

/**
 * What a sync couldn't write here, and the counts Franki would have had if it had: the counts
 * the sanity check needs, and the full download that follows brings.
 */
class SyncState {
  constructor(readonly collated: boolean) {}
  needsDownload: string[] = [];
  extraNotetypes = new Set<number>();
  extraDecks = new Set<number>();
  goneDecks = new Set<number>();
  extraDeckConfigs = new Set<number>();
  sortField = new Map<number, number>();

  later(reason: string) {
    if (!this.needsDownload.includes(reason)) this.needsDownload.push(reason);
  }
}

// ---- graves ----

async function pendingGraves(db: SyncDb): Promise<Graves> {
  const g: Graves = { cards: [], decks: [], notes: [] };
  for (const r of await db.all<{ oid: number; type: number }>('SELECT oid, type FROM graves WHERE usn = -1')) {
    if (r.type === GRAVE.card) g.cards.push(r.oid);
    else if (r.type === GRAVE.note) g.notes.push(r.oid);
    else if (r.type === GRAVE.deck) g.decks.push(r.oid);
  }
  return g;
}

function* graveChunks(g: Graves): Generator<Graves> {
  const all = [...g.cards.map((id) => ['cards', id] as const), ...g.notes.map((id) => ['notes', id] as const), ...g.decks.map((id) => ['decks', id] as const)];
  for (let i = 0; i < all.length; i += CHUNK_SIZE) {
    const chunk: Graves = { cards: [], decks: [], notes: [] };
    for (const [kind, id] of all.slice(i, i + CHUNK_SIZE)) chunk[kind].push(id);
    yield chunk;
  }
}

/** Whether this connection has Anki's collation, so the collated tables can be written. */
async function hasUnicase(db: SyncDb): Promise<boolean> {
  try {
    return (await db.first<{ ok: number }>("SELECT 'a' = 'A' COLLATE unicase AS ok"))?.ok === 1;
  } catch {
    return false;
  }
}

async function applyGraves(db: SyncDb, g: Graves, usn: number, state: SyncState): Promise<boolean> {
  for (const id of g.notes) {
    await db.run('DELETE FROM notes WHERE id = ?', id);
    await db.run('INSERT OR IGNORE INTO graves (usn, oid, type) VALUES (?, ?, ?)', usn, id, GRAVE.note);
  }
  for (const id of g.cards) {
    await db.run('DELETE FROM cards WHERE id = ?', id);
    await db.run('INSERT OR IGNORE INTO graves (usn, oid, type) VALUES (?, ?, ?)', usn, id, GRAVE.card);
  }
  for (const id of g.decks) {
    if (state.collated) {
      await db.run('DELETE FROM decks WHERE id = ?', id);
      await db.run('INSERT OR IGNORE INTO graves (usn, oid, type) VALUES (?, ?, ?)', usn, id, GRAVE.deck);
      continue;
    }
    if (await db.first('SELECT id FROM decks WHERE id = ?', id)) state.goneDecks.add(id);
    state.later('a deck was deleted');
  }
  return g.notes.length + g.cards.length + g.decks.length > 0;
}

// ---- unchunked changes ----

async function allConfig(db: SyncDb): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const r of await db.all<{ key: string; val: Uint8Array }>('SELECT KEY AS key, val FROM config')) {
    try { out[r.key] = parseJson(utf8Decode(r.val)); } catch { /* not JSON: Anki couldn't read it either */ }
  }
  return out;
}

async function applyUnchunked(db: SyncDb, c: UnchunkedChanges, usn: number, now: () => number, state: SyncState): Promise<boolean> {
  let changed = false;
  const nowSecs = Math.floor(now() / 1000);

  // As rslib's merge_notetypes: the newer one wins.
  for (const nt of (c.models ?? []) as NotetypeJson[]) {
    const id = Number(nt.id);
    const existing = await db.first<{ mtime_secs: number }>('SELECT mtime_secs FROM notetypes WHERE id = ?', id);
    if (existing && existing.mtime_secs > Number(nt.mod ?? 0)) continue;
    const rows = notetypeRows(nt);
    if (state.collated && existing) {
      // Anki refuses to merge a note type whose fields or templates were added or removed.
      const fields = (await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM fields WHERE ntid = ?', id))!.n;
      const templates = (await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM templates WHERE ntid = ?', id))!.n;
      if (fields !== rows.fields.length || templates !== rows.templates.length) {
        state.later("a note type's fields or card types changed");
        continue;
      }
    }
    if (!state.collated) {
      if (!existing) state.extraNotetypes.add(id);
      state.later('a note type changed');
      continue;
    }
    // ensure_notetype_name_unique: another note type with this name gets "+" added to this one.
    while (true) {
      const other = await db.first<{ id: number }>('SELECT id FROM notetypes WHERE name = ?', rows.name);
      if (!other || other.id === id) break;
      rows.name += '+';
      rows.mtime = nowSecs;
      rows.usn = usn;
    }
    await db.run('INSERT OR REPLACE INTO notetypes (id, name, mtime_secs, usn, config) VALUES (?, ?, ?, ?, ?)', id, rows.name, rows.mtime, rows.usn, rows.config);
    await db.run('DELETE FROM fields WHERE ntid = ?', id);
    for (const f of rows.fields) await db.run('INSERT INTO fields (ntid, ord, name, config) VALUES (?, ?, ?, ?)', id, f.ord, f.name, f.config);
    await db.run('DELETE FROM templates WHERE ntid = ?', id);
    for (const t of rows.templates) {
      await db.run('INSERT INTO templates (ntid, ord, name, mtime_secs, usn, config) VALUES (?, ?, ?, 0, 0, ?)', id, t.ord, t.name, t.config);
    }
    state.sortField.delete(id);
    changed = true;
  }

  const [decks, configs] = c.decks ?? [[], []];
  for (const d of decks) {
    const row = deckRow(d);
    const existing = await db.first<{ name: string; mtime_secs: number }>('SELECT name, mtime_secs FROM decks WHERE id = ?', row.id);
    if (existing && existing.mtime_secs > row.mtime) continue;
    if (state.collated) {
      // ensure_deck_name_unique: another deck with this name gets "+" added to this one.
      while (true) {
        const other = await db.first<{ id: number }>('SELECT id FROM decks WHERE name = ?', row.name);
        if (!other || other.id === row.id) break;
        row.name += '+';
        row.mtime = nowSecs;
        row.usn = usn;
      }
      await db.run('INSERT OR REPLACE INTO decks (id, name, mtime_secs, usn, common, kind) VALUES (?, ?, ?, ?, ?, ?)', row.id, row.name, row.mtime, row.usn, row.common, row.kind);
      changed = true;
    } else if (existing && existing.name === row.name) {
      // Without the collation only the columns outside the name's index can be written.
      await db.run('UPDATE decks SET mtime_secs = ?, usn = ?, common = ?, kind = ? WHERE id = ?', row.mtime, row.usn, row.common, row.kind, row.id);
      changed = true;
    } else {
      if (!existing) state.extraDecks.add(row.id);
      state.later(existing ? 'a deck was renamed' : 'a deck was added');
    }
  }

  for (const conf of configs as DeckConfigJson[]) {
    const id = Number(conf.id);
    const existing = await db.first<{ mtime_secs: number }>('SELECT mtime_secs FROM deck_config WHERE id = ?', id);
    if (existing && existing.mtime_secs > Number(conf.mod ?? 0)) continue;
    if (!state.collated) {
      if (!existing) state.extraDeckConfigs.add(id);
      state.later('deck options changed');
      continue;
    }
    const row = deckConfigRow(conf);
    await db.run('INSERT OR REPLACE INTO deck_config (id, name, mtime_secs, usn, config) VALUES (?, ?, ?, ?, ?)', row.id, row.name, row.mtime, row.usn, row.config);
    changed = true;
  }

  // The server sends a tag only when it's new or changed. Without the collation the tags table
  // can't even be read.
  for (const tag of c.tags ?? []) {
    if (!state.collated) {
      state.later('a tag was added or changed');
      break;
    }
    if (await registerTag(db, tag, usn)) changed = true;
  }

  if (c.crt !== undefined) {
    await db.run('UPDATE col SET crt = ?', c.crt);
    changed = true;
  }
  if (c.conf) {
    // As rslib's set_all_config: the server's config replaces this one's, every key.
    await db.run('DELETE FROM config');
    const mtime = Math.floor(now() / 1000);
    for (const [key, value] of Object.entries(c.conf)) {
      await db.run('INSERT OR REPLACE INTO config (KEY, usn, mtime_secs, val) VALUES (?, ?, ?, ?)', key, usn, mtime, utf8Encode(stringifyJson(value)));
    }
    changed = true;
  }
  return changed;
}

/**
 * As rslib's register_tag: a tag already here (whatever its case) is left as it is; a new one
 * takes the case of the nearest parent tag already here ("Polski::odmiana" under "polski" becomes
 * "polski::odmiana"), and starts collapsed. True when it was added.
 */
async function registerTag(db: SyncDb, tag: string, usn: number): Promise<boolean> {
  if (await db.first('SELECT tag FROM tags WHERE tag = ?', tag)) return false;
  let name = tag;
  for (let parent = tag; parent.includes('::');) {
    parent = parent.slice(0, parent.lastIndexOf('::'));
    const found = await db.first<{ tag: string }>('SELECT tag FROM tags WHERE tag = ?', parent);
    if (found) {
      const depth = found.tag.split('::').length;
      name = [found.tag, ...tag.split('::').slice(depth)].join('::');
      break;
    }
  }
  await db.run('INSERT OR REPLACE INTO tags (tag, usn, collapsed) VALUES (?, ?, 1)', name, usn);
  return true;
}

// ---- chunks ----

async function sortFieldOf(db: SyncDb, mid: number, state: SyncState): Promise<number> {
  if (!state.sortField.has(mid)) {
    const nt = await db.first<{ config: Uint8Array }>('SELECT config FROM notetypes WHERE id = ?', mid);
    state.sortField.set(mid, nt ? uint(decodeMessage(nt.config), NOTETYPE_SORT_FIELD) ?? 0 : 0);
  }
  return state.sortField.get(mid)!;
}

/** As rslib's apply_chunk: a row here that's waiting to be sent wins unless the server's is newer. */
async function applyChunk(db: SyncDb, chunk: Chunk, state: SyncState): Promise<boolean> {
  let changed = false;
  for (const r of chunk.revlog ?? []) {
    await db.run('INSERT OR IGNORE INTO revlog (id, cid, usn, ease, ivl, lastIvl, factor, time, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', ...r);
    changed = true;
  }
  for (const c of chunk.cards ?? []) {
    const existing = await db.first<{ usn: number; mod: number }>('SELECT usn, mod FROM cards WHERE id = ?', c[0]);
    if (existing && existing.usn === -1 && existing.mod >= c[4]) continue;
    await db.run('INSERT OR REPLACE INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', ...c);
    changed = true;
  }
  for (const n of chunk.notes ?? []) {
    const [id, guid, mid, mod, usn, tags, flds] = n;
    const existing = await db.first<{ usn: number; mod: number }>('SELECT usn, mod FROM notes WHERE id = ?', id);
    if (existing && existing.usn === -1 && existing.mod >= mod) continue;
    const fields = flds.split('\x1f').map(cleanField);
    const { sfld, csum } = sortFieldAndChecksum(fields, await sortFieldOf(db, mid, state));
    await db.run(
      "INSERT OR REPLACE INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '')",
      id, guid, mid, mod, usn, tags, fields.join('\x1f'), sfld, csum,
    );
    changed = true;
  }
  return changed;
}

/** The next chunk of Franki's own changes, marked as sent (rslib's get_chunk, on the client). */
async function takeChunk(db: SyncDb, ids: { revlog: number[]; cards: number[]; notes: number[] }, serverUsn: number): Promise<Chunk> {
  let limit = CHUNK_SIZE;
  const take = { revlog: [] as number[], cards: [] as number[], notes: [] as number[] };
  while (limit > 0) {
    const before = limit;
    for (const k of ['revlog', 'notes', 'cards'] as const) {
      const id = ids[k].pop();
      if (id !== undefined) { take[k].push(id); limit--; }
    }
    if (limit === before) break;
  }
  const chunk: Chunk = { done: limit > 0 };
  for (const k of ['revlog', 'cards', 'notes'] as const) {
    for (const id of take[k]) await db.run(`UPDATE ${k} SET usn = ? WHERE id = ?`, serverUsn, id);
  }
  if (take.revlog.length) {
    chunk.revlog = [];
    for (const id of take.revlog) {
      const r = (await db.first<Record<string, number>>('SELECT id, cid, usn, ease, ivl, lastIvl, factor, time, type FROM revlog WHERE id = ?', id))!;
      chunk.revlog.push([r.id, r.cid, serverUsn, r.ease, r.ivl, r.lastIvl, r.factor, r.time, r.type] as RevlogEntry);
    }
  }
  if (take.cards.length) {
    chunk.cards = [];
    for (const id of take.cards) {
      const c = (await db.first<Record<string, number | string>>('SELECT * FROM cards WHERE id = ?', id))!;
      chunk.cards.push([
        c.id, c.nid, c.did, c.ord, c.mod, serverUsn, c.type, c.queue, c.due, c.ivl, c.factor, c.reps,
        c.lapses, c.left, c.odue, c.odid, c.flags, c.data ?? '',
      ] as CardEntry);
    }
  }
  if (take.notes.length) {
    chunk.notes = [];
    for (const id of take.notes) {
      const n = (await db.first<Record<string, number | string>>('SELECT id, guid, mid, mod, tags, flds FROM notes WHERE id = ?', id))!;
      chunk.notes.push([n.id, n.guid, n.mid, n.mod, serverUsn, n.tags, n.flds, '', '', 0, ''] as NoteEntry);
    }
  }
  return chunk;
}

// ---- sanity ----

async function sanityCounts(db: SyncDb, state: SyncState): Promise<SanityCounts> {
  // NOT INDEXED: left to itself, SQLite counts decks through the index on their collated name.
  const count = async (t: string) => (await db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t} NOT INDEXED`))!.n;
  for (const t of ['cards', 'notes', 'revlog', 'graves']) {
    if ((await db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t} WHERE usn = -1`))!.n) {
      throw new Error(`${t} still has rows waiting to be sent after the sync sent them`);
    }
  }
  return [
    [0, 0, 0],
    await count('cards'),
    await count('notes'),
    await count('revlog'),
    await count('graves'),
    await count('notetypes') + state.extraNotetypes.size,
    await count('decks') + state.extraDecks.size - [...state.goneDecks].filter((id) => !state.extraDecks.has(id)).length,
    await count('deck_config') + state.extraDeckConfigs.size,
  ];
}

// ---- full sync ----

/**
 * Readies the collection to replace the server's (rslib's `before_upload`): nothing is left
 * waiting to be sent, and the schema time moves so every other device knows to download it.
 */
export async function prepareForUpload(db: SyncDb, now: () => number = Date.now): Promise<void> {
  await db.transaction(async () => {
    await db.run('DELETE FROM graves');
    for (const t of ['notes', 'cards', 'revlog']) await db.run(`UPDATE ${t} SET usn = 0 WHERE usn = -1`);
    // These four Anki zeroes outright (clear_deck_usns and the like). Tags only with the collation,
    // without which the table can't be written; Franki never marks a tag as changed anyway.
    for (const t of ['deck_config', 'decks', 'notetypes']) await db.run(`UPDATE ${t} SET usn = 0 WHERE usn != 0`);
    if (await hasUnicase(db)) await db.run('UPDATE tags SET usn = 0 WHERE usn != 0');
    const ms = now();
    await db.run('UPDATE col SET usn = usn + 1, scm = ?, ls = ?', ms, ms);
  });
}

/** After a full download (rslib's `full_download`): the collection counts as synced as it stands. */
export async function markDownloaded(db: SyncDb): Promise<void> {
  await db.run('UPDATE col SET ls = mod');
}

/** Downloads the server's whole collection (`sync/download`), streamed to `write` as it arrives. */
export async function downloadCollection(client: SyncClient, write: (chunk: Uint8Array) => void | Promise<void>): Promise<void> {
  await client.stream('sync/download', utf8Encode('{}'), write);
}

/** Replaces the server's collection with this file's bytes (`sync/upload`), after `prepareForUpload`. */
export async function uploadCollection(client: SyncClient, bytes: Uint8Array): Promise<void> {
  const reply = utf8Decode(await client.callBytes('sync/upload', bytes));
  if (reply !== 'OK') throw new SyncError('server', reply);
}
