import type { AnkiSearchRow, AnkiSearchTiming } from '../core/ankiRowSearch';
import { parseSearch, readsAnswers } from '../core/ankiSearch';
import { cleanDeckName } from '../core/deckNames';
import { gatherFiltered, type FilteredDeckConfig } from '../core/filteredDeck';
import { emptyFilteredDeck } from './customStudyWrites';
import { deckNamed, matchOrCreateParents, newDeckId, requireCollation } from './deckEdits';
import { DeckRefused } from './deckService';
import { utf8Decode } from './protobuf';
import { hasUnicase, type SyncDb } from './sync/collectionSync';
import { deckJson, deckRow, nativeDeckName } from './sync/deckRows';
import { parseJson } from './sync/json';
import { COL_MODIFIED_SQL, queueForType } from './writeback';

/**
 * Filtered decks made, rebuilt and emptied in the kept collection as Anki does them (rslib's
 * scheduler/filtered/mod.rs, card.rs): Rebuild empties the deck, then gathers each search in turn
 * (with Anki's exclusions, `gatherFiltered`), in its order and up to its limit, and moves the cards
 * in: home deck and due kept in odid and odue, a due that's a day or a time replaced by the card's
 * place from -100,000 up, and every card put in the review queue when the deck only previews.
 * Rows change with usn -1 and the collection is stamped modified, so a sync sends them. Checked
 * against the decks Anki builds in tests/anki/filteredDeckWrites.test.ts (make-filtered-vectors.py).
 */

/** Anki numbers a filtered deck's cards from here, so they sort before anything's own due. */
const POSITION_BASE = -100_000;

interface DeckRaw { id: number; name: string; mtime_secs: number; usn: number; common: Uint8Array; kind: Uint8Array }

const humanName = (native: string) => native.split('\x1f').join('::');

/**
 * Every card of the collection as Anki's search reads it. `revlog` only when a search needs it
 * (`rated:`, or the oldest-seen order). Field names come from the collection, or with no collation
 * registered (the fields table can't be read then) from `knownFields`, Franki's copy of each note type.
 */
export async function readSearchRows(db: SyncDb, opts: { revlog: boolean; knownFields: Map<string, string[]> }): Promise<AnkiSearchRow[]> {
  const decks = new Map((await db.all<{ id: number; name: string }>('SELECT id, name FROM decks NOT INDEXED')).map((d) => [Number(d.id), humanName(d.name)]));
  const types = await db.all<{ id: number; name: string }>('SELECT id, name FROM notetypes NOT INDEXED');
  const collated = await hasUnicase(db);
  const typeOf = new Map<number, { name: string; fields: string[] }>();
  for (const t of types) {
    const fields = collated
      ? (await db.all<{ name: string }>('SELECT name FROM fields WHERE ntid = ? ORDER BY ord', t.id)).map((f) => f.name)
      : opts.knownFields.get(t.name) ?? [];
    typeOf.set(Number(t.id), { name: t.name, fields });
  }
  const revlog = new Map<number, { id: number; ease: number }[]>();
  if (opts.revlog) {
    for (const r of await db.all<{ cid: number; id: number; ease: number }>('SELECT cid, id, ease FROM revlog')) {
      const cid = Number(r.cid);
      (revlog.get(cid) ?? revlog.set(cid, []).get(cid)!).push({ id: Number(r.id), ease: Number(r.ease) });
    }
  }
  const rows = await db.all<Record<string, unknown>>(
    'SELECT c.id, c.nid, c.did, c.odid, c.ord, c.type, c.queue, c.due, c.odue, c.ivl, c.factor, c.reps, c.lapses, c.flags, c.data, c.mod, n.flds, n.sfld, n.tags, n.mid FROM cards c JOIN notes n ON n.id = c.nid',
  );
  return rows.map((r) => {
    const t = typeOf.get(Number(r.mid));
    const odid = Number(r.odid);
    return {
      id: Number(r.id), nid: Number(r.nid), did: Number(r.did), odid, ord: Number(r.ord), type: Number(r.type), queue: Number(r.queue),
      due: Number(r.due), odue: Number(r.odue), ivl: Number(r.ivl), factor: Number(r.factor), reps: Number(r.reps), lapses: Number(r.lapses),
      flags: Number(r.flags), data: String(r.data ?? ''), mod: Number(r.mod), flds: String(r.flds ?? ''), sfld: String(r.sfld ?? ''),
      tags: String(r.tags ?? ''), notetype: t?.name ?? '', fieldNames: t?.fields ?? [],
      deckName: decks.get(Number(r.did)) ?? '', homeDeckName: odid ? decks.get(odid) : undefined, revlog: revlog.get(Number(r.id)) ?? [],
    };
  });
}

/** A filtered deck's settings as the collection keeps them, by its id. Undefined for none, or a normal deck. */
export async function readFilteredDeck(db: SyncDb, deckId: number): Promise<{ id: number; config: FilteredDeckConfig } | undefined> {
  const row = await db.first<DeckRaw>('SELECT id, name, mtime_secs, usn, common, kind FROM decks WHERE id = ?', deckId);
  if (!row) return undefined;
  const d = deckJson({ id: Number(row.id), name: row.name, mtime: Number(row.mtime_secs), usn: Number(row.usn), common: row.common, kind: row.kind });
  if (d.dyn !== 1) return undefined;
  const terms = (d.terms as [string, number, number][]).map(([search, limit, order]) => ({ search, limit, order }));
  return {
    id: Number(row.id),
    config: {
      name: String(d.name),
      // Anki keeps a second term even when it's unused: an empty search with a limit (`new_filtered`).
      terms: terms.filter((t, i) => i === 0 || t.search.trim() !== ''),
      reschedule: !!d.resched,
      previewAgainSecs: Number(d.previewAgainSecs ?? 0), previewHardSecs: Number(d.previewHardSecs ?? 0), previewGoodSecs: Number(d.previewGoodSecs ?? 0),
    },
  };
}

/** A filtered deck's id by its name as Franki has it, or undefined. */
export async function filteredDeckId(db: SyncDb, name: string): Promise<number | undefined> {
  const native = nativeDeckName(name);
  const row = (await db.all<DeckRaw>('SELECT id, name, mtime_secs, usn, common, kind FROM decks NOT INDEXED')).find((d) => d.name === native);
  return row && (await readFilteredDeck(db, Number(row.id))) ? Number(row.id) : undefined;
}

async function fsrsOn(db: SyncDb): Promise<boolean> {
  const row = await db.first<{ val: Uint8Array }>("SELECT val FROM config WHERE KEY = 'fsrs'");
  try { return !!row && parseJson(utf8Decode(row.val)) === true; } catch { return false; }
}

const needsRevlog = (c: FilteredDeckConfig) => c.terms.some((t) => t.order === 0 || (() => { const p = parseSearch(t.search); return p.ok && readsAnswers(p.node); })());

/**
 * A card as Anki sees it when it builds: one buried on an earlier study day is unburied, as Anki
 * does when the day rolls over (`unbury_if_day_rolled_over`), which Franki never writes back
 * (`isBuried` holds a card back only on the day it was buried). Its mod says when it was buried.
 */
function unburiedToday(row: AnkiSearchRow, t: AnkiSearchTiming): AnkiSearchRow {
  if ((row.queue !== -2 && row.queue !== -3) || row.mod >= t.nextDayAt - 86_400) return row;
  return { ...row, queue: queueForType(row.type, row.due) };
}

/** Empties the deck, gathers its searches again and moves the cards in. Returns how many went in. No transaction of its own. */
async function rebuildInside(db: SyncDb, deckId: number, config: FilteredDeckConfig, t: AnkiSearchTiming, knownFields: Map<string, string[]>, now: Date, random?: () => number): Promise<number> {
  await emptyFilteredDeck(db, deckId, now);
  const rows = (await readSearchRows(db, { revlog: needsRevlog(config), knownFields })).map((row) => unburiedToday(row, t));
  const picked = gatherFiltered(rows, config.terms, t, await fsrsOn(db), random);
  if (!picked) throw new DeckRefused('The search can\'t be read. Change it in the deck\'s options, then rebuild it.');
  const nowSecs = Math.floor(now.getTime() / 1000);
  let position = POSITION_BASE;
  for (const r of picked) {
    // As Anki's move_into_filtered_deck: a due that's a day or a time takes the card's place; one at 0 or before stays.
    const due = r.due > 0 ? position : r.due;
    await db.run('UPDATE cards SET odid = did, odue = due, did = ?, due = ?, queue = ?, mod = ?, usn = -1 WHERE id = ?',
      deckId, due, config.reschedule ? r.queue : 2, nowSecs, r.id);
    position++;
  }
  return picked.length;
}

/**
 * Makes a filtered deck, or changes one (`deckId`), and builds it, as Anki's Build does: a search
 * that gathers nothing is refused and nothing is changed. Returns the deck's id and name as stored,
 * and how many cards went in.
 */
export async function saveFilteredDeck(
  db: SyncDb, r: { deckId?: number; config: FilteredDeckConfig; timing: AnkiSearchTiming; knownFields: Map<string, string[]>; now: Date; random?: () => number },
): Promise<{ id: number; name: string; count: number }> {
  const cleaned = cleanDeckName(r.config.name);
  if ('problem' in cleaned) throw new DeckRefused(cleaned.problem);
  const nowSecs = Math.floor(r.now.getTime() / 1000);
  let out!: { id: number; name: string; count: number };
  await db.transaction(async () => {
    await requireCollation(db, r.deckId ? 'change a filtered deck' : 'add a filtered deck');
    let native = nativeDeckName(cleaned.name);
    const taken = await deckNamed(db, native);
    if (taken && Number(taken.id) !== r.deckId) throw new DeckRefused(`A deck called "${humanName(taken.name)}" already exists.`);
    const existing = r.deckId ? await db.first<DeckRaw>('SELECT id, name, mtime_secs, usn, common, kind FROM decks WHERE id = ?', r.deckId) : undefined;
    if (r.deckId && (!existing || !(await readFilteredDeck(db, r.deckId)))) throw new DeckRefused("Anki doesn't have this filtered deck anymore. Sync, then try again.");
    if (!existing || existing.name !== native) native = await matchOrCreateParents(db, native, r.now);
    const c = r.config;
    const row = deckRow({
      id: existing ? Number(existing.id) : await newDeckId(db, r.now.getTime()), name: humanName(native), mod: nowSecs, usn: -1,
      lrnToday: [0, 0], revToday: [0, 0], newToday: [0, 0], timeToday: [0, 0], collapsed: true, browserCollapsed: true, desc: '', dyn: 1,
      resched: c.reschedule, terms: c.terms.map((t) => [t.search.trim(), t.limit, t.order]), separate: true, delays: null,
      previewDelay: 0, previewAgainSecs: c.previewAgainSecs, previewHardSecs: c.previewHardSecs, previewGoodSecs: c.previewGoodSecs,
    });
    if (existing) {
      // Its own counts and collapsed state stay: only the name and settings change.
      await db.run('UPDATE decks SET name = ?, kind = ?, mtime_secs = ?, usn = -1 WHERE id = ?', native, row.kind, nowSecs, row.id);
    } else {
      await db.run('INSERT INTO decks (id, name, mtime_secs, usn, common, kind) VALUES (?, ?, ?, -1, ?, ?)', row.id, native, nowSecs, row.common, row.kind);
    }
    const count = await rebuildInside(db, row.id, { ...c, terms: c.terms.map((t) => ({ ...t, search: t.search.trim() })) }, r.timing, r.knownFields, r.now, r.random);
    // As Anki's Build: a deck its searches leave empty isn't made (or changed). Throwing rolls it all back.
    if (count === 0) throw new DeckRefused('No cards match these searches. Suspended and buried cards, and cards already in another filtered deck, are left out. Change the search, then build it again.');
    await db.run(COL_MODIFIED_SQL, r.now.getTime());
    out = { id: row.id, name: humanName(native), count };
  });
  return out;
}

/** Rebuilds a filtered deck as it's set (Anki's Rebuild). Returns how many cards went in; it may be none. */
export async function rebuildAnkiFilteredDeck(db: SyncDb, deckId: number, timing: AnkiSearchTiming, knownFields: Map<string, string[]>, now: Date, random?: () => number): Promise<number> {
  let count = 0;
  await db.transaction(async () => {
    const deck = await readFilteredDeck(db, deckId);
    if (!deck) throw new DeckRefused("Anki doesn't have this filtered deck anymore. Sync, then try again.");
    count = await rebuildInside(db, deckId, deck.config, timing, knownFields, now, random);
    await db.run(COL_MODIFIED_SQL, now.getTime());
  });
  return count;
}

/** Sends a filtered deck's cards home (Anki's Empty). Returns how many went. */
export async function emptyAnkiFilteredDeck(db: SyncDb, deckId: number, now: Date): Promise<number> {
  let count = 0;
  await db.transaction(async () => {
    if (!(await readFilteredDeck(db, deckId))) throw new DeckRefused("Anki doesn't have this filtered deck anymore. Sync, then try again.");
    count = await emptyFilteredDeck(db, deckId, now);
    await db.run(COL_MODIFIED_SQL, now.getTime());
  });
  return count;
}
