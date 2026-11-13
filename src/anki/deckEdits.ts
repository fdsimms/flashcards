import { decodeMessage, MessageWriter } from './protobuf';
import { emptyFilteredDeck } from './customStudyWrites';
import { hasUnicase, type SyncDb } from './sync/collectionSync';
import { nativeDeckName } from './sync/deckRows';
import { COL_MODIFIED_SQL } from './writeback';
import { cleanDeckName } from '../core/deckNames';
import { Refusal } from '../core/failure';

/**
 * Decks made, renamed and deleted in Franki, written into the kept Anki collection the way Anki
 * writes them (rslib/src/decks: add.rs, name.rs, remove.rs), so sync and Send to Anki carry them
 * back: every changed deck is marked unsent (usn -1, sent in sync's applyChanges), a deleted
 * deck, card or note leaves a grave, and the collection is stamped modified. Checked against
 * what Anki itself writes (tests/fixtures/anki/deck-vectors.json). Runs on a connection of its
 * own to the kept collection (`withSyncConnection`), inside `lockAnki`.
 *
 * The decks table's name is under Anki's collation (`unicase`), which writing a name, or deleting
 * a row, needs: a build made before modules/anki-unicase can't do any of this, and is refused.
 * Names are compared through the collation too, so "polski" finds "Polski" as Anki does.
 */

/** Why a deck can't be made, renamed or deleted, with what to do, to show as it is. */
export class DeckRefused extends Refusal {}

const COMMON = { studyCollapsed: 1, browserCollapsed: 2 }; // Deck.Common
const KIND = { normal: 1, filtered: 2 }; // Deck.KindContainer
const NORMAL = { configId: 1 }; // Deck.Normal
const GRAVE = { card: 0, note: 1, deck: 2 } as const;
const DEFAULT_DECK = 1;

/** A new normal deck as Anki makes one (`Deck::new_normal`): collapsed both ways, on the Default preset. */
const NEW_COMMON = new MessageWriter().uint(COMMON.studyCollapsed, 1).uint(COMMON.browserCollapsed, 1).finish();
const NEW_KIND = new MessageWriter().bytes(KIND.normal, new MessageWriter().uint(NORMAL.configId, 1).finish()).finish();

const humanName = (native: string) => native.split('\x1f').join('::');
const isFiltered = (kind: Uint8Array) => decodeMessage(kind).has(KIND.filtered);

interface DeckRowRaw { id: number; name: string; kind: Uint8Array }

/** A deck by its name as Anki finds one: through the collation, so case doesn't matter. */
const deckNamed = (db: SyncDb, native: string) => db.first<DeckRowRaw>('SELECT id, name, kind FROM decks WHERE name = ?', native);
/** A deck by its exact name, as Franki has it from the collection. Read by scanning: no collation needed. */
async function deckExactly(db: SyncDb, native: string): Promise<DeckRowRaw | null> {
  return (await db.all<DeckRowRaw>('SELECT id, name, kind FROM decks NOT INDEXED')).find((d) => d.name === native) ?? null;
}

/** A typed name as Anki stores one (`cleanDeckName`: trimmed, NFC), or refused with why. */
function cleaned(name: string): string {
  const r = cleanDeckName(name);
  if ('problem' in r) throw new DeckRefused(r.problem);
  return r.name;
}

async function requireCollation(db: SyncDb, what: string) {
  if (!(await hasUnicase(db))) {
    throw new DeckRefused(`This build of Franki can't ${what} in your Anki collection. Rebuild the app, or do it in Anki and sync.`);
  }
}

/** A new deck's id as Anki's storage gives one (alloc_id.sql): now in milliseconds, or past the largest id when that's taken. */
async function newDeckId(db: SyncDb, nowMs: number): Promise<number> {
  const r = await db.first<{ id: number }>('SELECT CASE WHEN ? IN (SELECT id FROM decks) THEN (SELECT MAX(id) + 1 FROM decks) ELSE ? END AS id', nowMs, nowMs);
  return Number(r!.id);
}

async function insertNormalDeck(db: SyncDb, native: string, now: Date): Promise<void> {
  const id = await newDeckId(db, now.getTime());
  await db.run('INSERT INTO decks (id, name, mtime_secs, usn, common, kind) VALUES (?, ?, ?, -1, ?, ?)', id, native, Math.floor(now.getTime() / 1000), NEW_COMMON, NEW_KIND);
}

/** Adds each missing parent of `native`, the nearest first, as Anki's `create_missing_parents` does. */
async function createMissingParents(db: SyncDb, native: string, now: Date): Promise<void> {
  const parts = native.split('\x1f');
  for (let i = parts.length - 1; i >= 1; i--) {
    const parent = parts.slice(0, i).join('\x1f');
    if (!(await deckNamed(db, parent))) await insertNormalDeck(db, parent, now);
  }
}

/**
 * `native` with its nearest existing parent's spelling, and the parents missing below that one
 * made, as Anki's `match_or_create_parents` does. A filtered deck can't be a parent.
 */
async function matchOrCreateParents(db: SyncDb, native: string, now: Date): Promise<string> {
  const parts = native.split('\x1f');
  for (let i = parts.length - 1; i >= 1; i--) {
    const parent = await deckNamed(db, parts.slice(0, i).join('\x1f'));
    if (!parent) continue;
    if (isFiltered(parent.kind)) throw new DeckRefused(`"${humanName(parent.name)}" is a filtered deck, and a filtered deck can't have subdecks.`);
    const matched = [parent.name, ...parts.slice(i)].join('\x1f');
    if (i !== parts.length - 1) await createMissingParents(db, matched, now);
    return matched;
  }
  await createMissingParents(db, native, now);
  return native;
}

/** Makes a normal deck called `name` ("A::B"), and any parent it lacks. Returns its name as stored. */
export async function addAnkiDeck(db: SyncDb, name: string, now: Date): Promise<string> {
  let made = '';
  await db.transaction(async () => {
    await requireCollation(db, 'add a deck');
    const native = nativeDeckName(cleaned(name));
    const existing = await deckNamed(db, native);
    if (existing) throw new DeckRefused(`A deck called "${humanName(existing.name)}" already exists.`);
    made = await matchOrCreateParents(db, native, now);
    await insertNormalDeck(db, made, now);
    await db.run(COL_MODIFIED_SQL, now.getTime());
  });
  return humanName(made);
}

/**
 * Renames the deck `from` (as Franki has it) to `to`, and every deck under it, as Anki's
 * `rename_deck` does: the parents `to` lacks are made, and an existing parent's spelling kept.
 * Returns the new name as stored, or null when Anki has no deck called `from`.
 */
export async function renameAnkiDeck(db: SyncDb, from: string, to: string, now: Date): Promise<string | null> {
  let result: string | null = null;
  await db.transaction(async () => {
    const source = await deckExactly(db, nativeDeckName(from));
    if (!source) return;
    await requireCollation(db, 'rename a deck');
    const target = nativeDeckName(cleaned(to));
    result = humanName(source.name);
    if (target === source.name) return;
    const prefix = `${source.name}\x1f`;
    const under = (await db.all<DeckRowRaw>('SELECT id, name, kind FROM decks NOT INDEXED')).filter((d) => d.name.startsWith(prefix));
    const inside = new Set([source.id, ...under.map((d) => d.id)]);
    const parts = target.split('\x1f');
    for (let i = 1; i < parts.length; i++) {
      const same = await db.first<{ same: number }>('SELECT ? = ? COLLATE unicase AS same', parts.slice(0, i).join('\x1f'), source.name);
      if (same?.same) throw new DeckRefused(`A deck can't go inside itself. Choose a name that doesn't start with "${from}::".`);
    }
    for (const name of [target, ...under.map((d) => target + d.name.slice(source.name.length))]) {
      const other = await deckNamed(db, name);
      if (other && !inside.has(other.id)) throw new DeckRefused(`A deck called "${humanName(other.name)}" already exists.`);
    }
    const renamed = await matchOrCreateParents(db, target, now);
    const nowSecs = Math.floor(now.getTime() / 1000);
    await db.run('UPDATE decks SET name = ?, mtime_secs = ?, usn = -1 WHERE id = ?', renamed, nowSecs, source.id);
    for (const d of under) {
      await db.run('UPDATE decks SET name = ?, mtime_secs = ?, usn = -1 WHERE id = ?', renamed + d.name.slice(source.name.length), nowSecs, d.id);
    }
    await db.run(COL_MODIFIED_SQL, now.getTime());
    result = humanName(renamed);
  });
  return result;
}

/** The deck `name` (as Franki has it) and the decks under it, the deck itself first. */
async function subtree(db: SyncDb, name: string): Promise<DeckRowRaw[] | null> {
  const native = nativeDeckName(name);
  const all = await db.all<DeckRowRaw>('SELECT id, name, kind FROM decks NOT INDEXED');
  const root = all.find((d) => d.name === native);
  if (!root) return null;
  return [root, ...all.filter((d) => d.name.startsWith(`${native}\x1f`))];
}

/** The cards deleting `decks` deletes: every card whose own deck is a normal one of them, wherever it's studied. */
async function cardsOf(db: SyncDb, decks: DeckRowRaw[]): Promise<{ id: number; nid: number }[]> {
  const ids = decks.filter((d) => !isFiltered(d.kind)).map((d) => d.id);
  if (!ids.length) return [];
  const marks = ids.map(() => '?').join(', ');
  return db.all<{ id: number; nid: number }>(`SELECT id, nid FROM cards WHERE did IN (${marks}) OR odid IN (${marks})`, ...ids, ...ids);
}

/** What deleting the deck `name` deletes in Anki, to ask before it's done; null when Anki has no such deck. */
export async function ankiDeckDeletion(db: SyncDb, name: string): Promise<{ cards: number; keepsDeck: boolean } | null> {
  const decks = await subtree(db, name);
  if (!decks) return null;
  return { cards: (await cardsOf(db, decks)).length, keepsDeck: decks[0].id === DEFAULT_DECK };
}

/**
 * Deletes the deck `name` (as Franki has it) and every deck under it, as Anki's `remove_decks`
 * does: each normal deck's cards, wherever they're studied, then the notes left with no cards,
 * all with graves; a filtered deck's cards go back to their own decks first. The Default deck
 * is emptied but kept, named Default again, as Anki keeps it. Returns how many cards were
 * deleted, or null when Anki has no such deck.
 */
export async function removeAnkiDeck(db: SyncDb, name: string, now: Date): Promise<number | null> {
  let deleted: number | null = null;
  await db.transaction(async () => {
    const decks = await subtree(db, name);
    if (!decks) return;
    await requireCollation(db, 'delete a deck');
    const cards = await cardsOf(db, decks);
    for (const c of cards) {
      await db.run('DELETE FROM cards WHERE id = ?', c.id);
      await db.run('INSERT OR REPLACE INTO graves (usn, oid, type) VALUES (-1, ?, ?)', c.id, GRAVE.card);
    }
    for (const nid of new Set(cards.map((c) => c.nid))) {
      if (await db.first('SELECT id FROM cards WHERE nid = ? LIMIT 1', nid)) continue;
      await db.run('DELETE FROM notes WHERE id = ?', nid);
      await db.run('INSERT OR REPLACE INTO graves (usn, oid, type) VALUES (-1, ?, ?)', nid, GRAVE.note);
    }
    const keys = (await db.all<{ key: string }>('SELECT KEY AS key FROM config')).map((r) => r.key);
    const nowSecs = Math.floor(now.getTime() / 1000);
    for (const d of decks) {
      if (isFiltered(d.kind)) await emptyFilteredDeck(db, d.id, now);
      // The deck's own settings kept in the config (`clear_aux_config_for_deck`): its last note type.
      for (const key of keys.filter((k) => k.startsWith(`_deck_${d.id}_`))) await db.run('DELETE FROM config WHERE KEY = ?', key);
      if (d.id === DEFAULT_DECK) {
        let kept = 'Default';
        while (true) {
          const other = await deckNamed(db, kept);
          if (!other || other.id === DEFAULT_DECK) break;
          kept += '+';
        }
        await db.run('UPDATE decks SET name = ?, mtime_secs = ?, usn = -1 WHERE id = ?', kept, nowSecs, d.id);
      } else {
        await db.run('DELETE FROM decks WHERE id = ?', d.id);
        await db.run('INSERT OR REPLACE INTO graves (usn, oid, type) VALUES (-1, ?, ?)', d.id, GRAVE.deck);
      }
    }
    await db.run(COL_MODIFIED_SQL, now.getTime());
    deleted = cards.length;
  });
  return deleted;
}
