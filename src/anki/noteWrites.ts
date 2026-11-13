import { decodeMessage, uint, utf8Decode, utf8Encode } from './protobuf';
import { hasUnicase, registerTag, type SyncDb } from './sync/collectionSync';
import { parseJson, stringifyJson } from './sync/json';
import { cleanField, sortFieldAndChecksum } from './sync/noteFields';
import { queueForType } from './writeback';

/**
 * Notes added, edited and deleted in Franki, written into the kept Anki collection the way Anki
 * writes them (rslib/src/notes, rslib/src/card, rslib/src/storage), so Send to Anki and sync
 * carry them back: every changed row is marked unsent (usn -1) and the collection stamped
 * modified. Runs on a connection of its own to the kept collection (`withSyncConnection`).
 *
 * Without Anki's collation (a build made before modules/anki-unicase) a new tag can't be added to
 * the tags table; the note still carries it, and Anki's Check Database registers it.
 */

const SORT_FIELD = 2; // Notetype.Config.sort_field_idx
const GRAVE = { card: 0, note: 1 } as const;

export interface AnkiNoteType {
  id: number;
  name: string;
  fieldNames: string[];
  sortFieldIdx: number;
}

/**
 * A note type of the collection by name, with its fields in order. The fields table can't be read
 * at all without Anki's collation, so `knownFields` (Franki's copy of the note type, taken from
 * the collection at import) stands in for it then.
 */
export async function ankiNoteType(db: SyncDb, name: string, knownFields: string[]): Promise<AnkiNoteType | null> {
  // NOT INDEXED, and the name compared here: a lookup by name would need Anki's collation.
  const rows = await db.all<{ id: number; name: string; config: Uint8Array }>('SELECT id, name, config FROM notetypes NOT INDEXED');
  const nt = rows.find((r) => r.name === name);
  if (!nt) return null;
  let fieldNames = knownFields;
  if (await hasUnicase(db)) {
    fieldNames = (await db.all<{ name: string }>('SELECT name FROM fields WHERE ntid = ? ORDER BY ord', nt.id)).map((f) => f.name);
  }
  return { id: nt.id, name: nt.name, fieldNames, sortFieldIdx: uint(decodeMessage(nt.config), SORT_FIELD) ?? 0 };
}

/** A deck's id by its name ("A::B"), or null when the collection has no such deck. */
export async function ankiDeckId(db: SyncDb, name: string): Promise<number | null> {
  const native = name.split('::').join('\x1f');
  const rows = await db.all<{ id: number; name: string }>('SELECT id, name FROM decks NOT INDEXED');
  return rows.find((r) => r.name === native)?.id ?? null;
}

const BASE91 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~';

/** A note's guid as Anki makes one: a random 64-bit number in Anki's base 91 (`base91_u64`). */
export function newGuid(random: () => number = Math.random): string {
  let n = (BigInt(Math.floor(random() * 2 ** 32)) << 32n) | BigInt(Math.floor(random() * 2 ** 32));
  let out = '';
  do { out = BASE91[Number(n % 91n)] + out; n /= 91n; } while (n > 0n);
  return out;
}

/** An id as Anki gives one: the time in milliseconds, moved past any id the table already has. */
async function nextId(db: SyncDb, table: 'notes' | 'cards', ms: number): Promise<number> {
  const max = (await db.first<{ m: number | null }>(`SELECT MAX(id) AS m FROM ${table}`))?.m ?? 0;
  return Math.max(ms, max + 1);
}

/**
 * A note's tags as Anki stores them: each once (whatever its case), sorted, space-separated with a
 * space at each end. With the collation, a tag the collection already has takes its case there,
 * and a new one is registered (unsent).
 */
async function canonicalTags(db: SyncDb, tags: string[], collated: boolean): Promise<string> {
  const seen = new Map<string, string>();
  for (const raw of tags) {
    const tag = raw.trim().replace(/\s+/g, '_');
    if (tag && !seen.has(tag.toLowerCase())) seen.set(tag.toLowerCase(), tag);
  }
  const out: string[] = [];
  for (const tag of seen.values()) {
    if (collated) {
      const existing = await db.first<{ tag: string }>('SELECT tag FROM tags WHERE tag = ?', tag);
      if (existing) { out.push(existing.tag); continue; }
      await registerTag(db, tag, -1);
      out.push((await db.first<{ tag: string }>('SELECT tag FROM tags WHERE tag = ?', tag))!.tag);
    } else {
      out.push(tag);
    }
  }
  out.sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0));
  return out.length ? ` ${out.join(' ')} ` : '';
}

/** The next new-card position, as Anki's `nextPos` config counts them, moved on by one. */
async function takeNewPosition(db: SyncDb, nowSecs: number): Promise<number> {
  const row = await db.first<{ val: Uint8Array }>("SELECT val FROM config WHERE KEY = 'nextPos'");
  let pos = 1;
  try { if (row) pos = Number(parseJson(utf8Decode(row.val))) || 1; } catch { /* unreadable: start over */ }
  await db.run("INSERT OR REPLACE INTO config (KEY, usn, mtime_secs, val) VALUES ('nextPos', -1, ?, ?)", nowSecs, utf8Encode(stringifyJson(pos + 1)));
  return pos;
}

async function addCards(db: SyncDb, nid: number, did: number, ords: number[], now: Date): Promise<{ ord: number; id: number }[]> {
  if (!ords.length) return [];
  const nowSecs = Math.floor(now.getTime() / 1000);
  const due = await takeNewPosition(db, nowSecs);
  const out: { ord: number; id: number }[] = [];
  for (const ord of ords) {
    const id = await nextId(db, 'cards', now.getTime());
    await db.run(
      "INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data) VALUES (?, ?, ?, ?, ?, -1, 0, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, '{}')",
      id, nid, did, ord, nowSecs, due,
    );
    out.push({ ord, id });
  }
  return out;
}

function noteRow(nt: AnkiNoteType, fields: Record<string, string>) {
  const values = nt.fieldNames.map((name) => cleanField(fields[name] ?? ''));
  return { flds: values.join('\x1f'), ...sortFieldAndChecksum(values, nt.sortFieldIdx) };
}

export interface NoteWrite {
  noteType: AnkiNoteType;
  fields: Record<string, string>;
  tags: string[];
  /** The card templates (ordinals) the note generates. */
  ords: number[];
  now: Date;
}

/** Adds a note and its cards to a deck. */
export async function addAnkiNote(db: SyncDb, w: NoteWrite & { deckId: number; random?: () => number }): Promise<{ nid: number; cards: { ord: number; id: number }[] }> {
  const collated = await hasUnicase(db);
  let result!: { nid: number; cards: { ord: number; id: number }[] };
  await db.transaction(async () => {
    const nid = await nextId(db, 'notes', w.now.getTime());
    const { flds, sfld, csum } = noteRow(w.noteType, w.fields);
    await db.run(
      "INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data) VALUES (?, ?, ?, ?, -1, ?, ?, ?, ?, 0, '')",
      nid, newGuid(w.random), w.noteType.id, Math.floor(w.now.getTime() / 1000), await canonicalTags(db, w.tags, collated), flds, sfld, csum,
    );
    const cards = await addCards(db, nid, w.deckId, w.ords, w.now);
    await db.run('UPDATE col SET mod = ?', w.now.getTime());
    result = { nid, cards };
  });
  return result;
}

/**
 * Changes a note's fields and tags, and adds a card for any template it now generates and
 * didn't before (into the deck its cards are in), as Anki does. A card it no longer generates
 * stays, as in Anki (its "empty cards"). Returns the cards added.
 */
export async function editAnkiNote(db: SyncDb, w: NoteWrite & { nid: number }): Promise<{ ord: number; id: number }[]> {
  const collated = await hasUnicase(db);
  let added: { ord: number; id: number }[] = [];
  await db.transaction(async () => {
    const { flds, sfld, csum } = noteRow(w.noteType, w.fields);
    const tags = await canonicalTags(db, w.tags, collated);
    const current = await db.first<{ flds: string; tags: string }>('SELECT flds, tags FROM notes WHERE id = ?', w.nid);
    if (!current) throw new Error(`Note ${w.nid} isn't in the Anki collection.`);
    if (current.flds !== flds || current.tags !== tags) {
      await db.run('UPDATE notes SET flds = ?, sfld = ?, csum = ?, tags = ?, mod = ?, usn = -1 WHERE id = ?', flds, sfld, csum, tags, Math.floor(w.now.getTime() / 1000), w.nid);
    }
    // A card in a filtered deck has its home in odid: Anki generates a new card there, never into a filtered deck.
    const existing = await db.all<{ ord: number; did: number }>('SELECT ord, CASE odid WHEN 0 THEN did ELSE odid END AS did FROM cards WHERE nid = ? ORDER BY ord', w.nid);
    const have = new Set(existing.map((c) => c.ord));
    const missing = w.ords.filter((o) => !have.has(o));
    if (missing.length) added = await addCards(db, w.nid, existing[0]?.did ?? 1, missing, w.now);
    if (current.flds !== flds || current.tags !== tags || missing.length) await db.run('UPDATE col SET mod = ?', w.now.getTime());
  });
  return added;
}

/**
 * Moves a note's cards to another deck, as Anki's Change Deck does (`Card::set_deck`): a card in a
 * filtered deck is first taken out of it, as Empty does (`emptyFilteredDeck`), then moved.
 */
export async function moveAnkiNote(db: SyncDb, nid: number, deckId: number, now: Date): Promise<void> {
  const nowSecs = Math.floor(now.getTime() / 1000);
  await db.transaction(async () => {
    await db.run('UPDATE cards SET did = ?, mod = ?, usn = -1 WHERE nid = ? AND odid = 0 AND did != ?', deckId, nowSecs, nid, deckId);
    const filtered = await db.all<{ id: number; type: number; queue: number; due: number; odue: number }>(
      'SELECT id, type, queue, due, odue FROM cards WHERE nid = ? AND odid != 0', nid,
    );
    for (const c of filtered) {
      const due = c.odue !== 0 ? c.odue : c.due;
      const queue = c.queue >= 0 ? queueForType(c.type, due) : c.queue;
      await db.run('UPDATE cards SET did = ?, odid = 0, odue = 0, due = ?, queue = ?, mod = ?, usn = -1 WHERE id = ?', deckId, due, queue, nowSecs, c.id);
    }
    await db.run('UPDATE col SET mod = ?', now.getTime());
  });
}

/** Deletes notes with their cards, leaving the graves sync sends so Anki deletes them too. Review history stays, as in Anki. */
export async function deleteAnkiNotes(db: SyncDb, nids: number[], now: Date): Promise<void> {
  await db.transaction(async () => {
    for (const nid of nids) {
      for (const c of await db.all<{ id: number }>('SELECT id FROM cards WHERE nid = ?', nid)) {
        await db.run('DELETE FROM cards WHERE id = ?', c.id);
        await db.run('INSERT OR REPLACE INTO graves (usn, oid, type) VALUES (-1, ?, ?)', c.id, GRAVE.card);
      }
      await db.run('DELETE FROM notes WHERE id = ?', nid);
      await db.run('INSERT OR REPLACE INTO graves (usn, oid, type) VALUES (-1, ?, ?)', nid, GRAVE.note);
    }
    await db.run('UPDATE col SET mod = ?', now.getTime());
  });
}
