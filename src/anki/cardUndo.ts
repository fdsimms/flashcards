import { cardStateOf, withCardState, type CardState } from '../core/cardState';
import { restoreCard, type CardAction } from '../core/session';
import type { Card } from '../core/types';
import type { NoteStore } from './noteService';
import type { SyncDb } from './sync/collectionSync';
import { CARD_STATE_UPDATE_SQL, COL_MODIFIED_SQL, cardStateParams } from './writeback';

/**
 * Undo for what Review's menu does to cards (bury, suspend, flag, Set Due Date, Forget), in the
 * kept collection as Anki's own undo does it: each card's row goes back to what it was, mod and
 * usn included, any review log row the action added ("Manual", for Set Due Date and Forget) is
 * deleted, and a config value it moved (Forget's `nextPos`) is put back. As with an answer
 * (`undoAnkiAnswer`), undo stops at the last sync: once a sync has sent the action, its rows carry
 * the server's usn and the action is in the server's history, so it's refused and nothing changes.
 */

/** The columns of an Anki `cards` row a menu action can change, as they were before it. */
export interface CardRowBefore {
  cid: number;
  did: number;
  odid: number;
  odue: number;
  type: number;
  queue: number;
  due: number;
  ivl: number;
  factor: number;
  reps: number;
  lapses: number;
  left: number;
  flags: number;
  data: string;
  mod: number;
  usn: number;
}

/** What it takes to undo one menu action in the kept collection. */
export interface AnkiActionUndo {
  cards: CardRowBefore[];
  /** Review log rows the action added: undo deletes them. */
  revlogIds: number[];
  /** Config values the action changed, as they were; `row` null for one that wasn't there. */
  config: { key: string; row: { usn: number; mtime_secs: number; val: Uint8Array } | null }[];
}

const ROW_SQL =
  'SELECT id AS cid, did, odid, odue, type, queue, due, ivl, factor, reps, lapses, left, flags, data, mod, usn FROM cards WHERE id = ?';
const RESTORE_SQL =
  'UPDATE cards SET did = ?, odid = ?, odue = ?, type = ?, queue = ?, due = ?, ivl = ?, factor = ?, reps = ?, lapses = ?, ' +
  'left = ?, flags = ?, data = ?, mod = ?, usn = ? WHERE id = ?';

/** The cards' rows as they are now, for an action about to change them. A card the collection doesn't have is left out. */
export async function readCardRows(db: SyncDb, cids: number[]): Promise<CardRowBefore[]> {
  const out: CardRowBefore[] = [];
  for (const cid of cids) {
    const row = await db.first<CardRowBefore>(ROW_SQL, cid);
    if (row) out.push({ ...row, cid: Number(row.cid), data: row.data ?? '' });
  }
  return out;
}

/** A config row as it is now, for an action about to change it; null when there's none. */
export async function readConfigRow(db: SyncDb, key: string): Promise<AnkiActionUndo['config'][number]> {
  const row = await db.first<{ usn: number; mtime_secs: number; val: Uint8Array }>('SELECT usn, mtime_secs, val FROM config WHERE KEY = ?', key);
  return { key, row: row ? { usn: row.usn, mtime_secs: row.mtime_secs, val: row.val } : null };
}

/**
 * Buries, suspends or flags cards in the kept collection as Anki writes it (`cardStateParams`, the
 * same write as `setAnkiCardStates`), and returns what undoes it.
 */
export async function setAnkiCardStatesUndoable(db: SyncDb, changes: { cid: number; state: CardState }[], now: Date): Promise<AnkiActionUndo> {
  let cards: CardRowBefore[] = [];
  await db.transaction(async () => {
    cards = await readCardRows(db, changes.map((c) => c.cid));
    const byCid = new Map(cards.map((r) => [r.cid, r]));
    for (const { cid, state } of changes) {
      const row = byCid.get(cid);
      if (row) await db.run(CARD_STATE_UPDATE_SQL, ...cardStateParams(row, state, now, cid));
    }
    await db.run(COL_MODIFIED_SQL, now.getTime());
  });
  return { cards, revlogIds: [], config: [] };
}

/** Takes an action back out of the kept collection. False, changing nothing, when a sync has sent it since. */
export async function undoAnkiAction(db: SyncDb, u: AnkiActionUndo, now: Date): Promise<boolean> {
  // The action left every row it wrote with usn -1; a sync since gave them the server's.
  for (const c of u.cards) {
    const r = await db.first<{ usn: number }>('SELECT usn FROM cards WHERE id = ?', c.cid);
    if (!r || r.usn !== -1) return false;
  }
  for (const id of u.revlogIds) {
    const r = await db.first<{ usn: number }>('SELECT usn FROM revlog WHERE id = ?', id);
    if (!r || r.usn !== -1) return false;
  }
  await db.transaction(async () => {
    for (const c of u.cards) {
      await db.run(RESTORE_SQL, c.did, c.odid, c.odue, c.type, c.queue, c.due, c.ivl, c.factor, c.reps, c.lapses, c.left, c.flags, c.data, c.mod, c.usn, c.cid);
    }
    for (const id of u.revlogIds) await db.run('DELETE FROM revlog WHERE id = ?', id);
    for (const { key, row } of u.config) {
      if (row) await db.run('INSERT OR REPLACE INTO config (KEY, usn, mtime_secs, val) VALUES (?, ?, ?, ?)', key, row.usn, row.mtime_secs, row.val);
      else await db.run('DELETE FROM config WHERE KEY = ?', key);
    }
    await db.run(COL_MODIFIED_SQL, now.getTime());
  });
  return true;
}

type ActionStore = Pick<NoteStore, 'saveCard' | 'keptCollection' | 'lockAnki' | 'withSyncConnection'>;

/**
 * Review's bury, suspend and flag: in Franki first, then in the kept collection (as `setCardStates`
 * does), keeping what undoes it there. An `ankiError` means Franki changed and Anki didn't, so
 * there's nothing to undo in Anki (`anki` is undefined).
 */
export async function setCardStatesUndoable(
  store: ActionStore, targets: Card[], change: (s: CardState) => CardState, now: Date, dayStartsAtHour: number,
): Promise<{ cards: Card[]; anki?: AnkiActionUndo; ankiError?: unknown }> {
  const cards = targets.map((t) => withCardState(t, change(cardStateOf(t, now, dayStartsAtHour)), now));
  for (const c of cards) await store.saveCard(c);
  const inAnki = cards.filter((c) => c.ankiId);
  if (!inAnki.length || !(await store.keptCollection())) return { cards };
  try {
    const anki = await store.lockAnki(() => store.withSyncConnection((db) =>
      setAnkiCardStatesUndoable(db, inAnki.map((c) => ({ cid: Number(c.ankiId), state: cardStateOf(c, now, dayStartsAtHour) })), now)));
    return { cards, anki };
  } catch (e) {
    return { cards, ankiError: e };
  }
}

/**
 * Takes a menu action back: out of the kept collection first (refused once synced, returning null
 * with nothing changed), then each card in Franki as it was (`restoreCard`), over the card as it
 * is now (`live`). Returns the cards as saved.
 */
export async function undoCardAction(store: ActionStore, action: CardAction, live: Card[], now: Date): Promise<Card[] | null> {
  if (action.anki && (await store.keptCollection())) {
    const done = await store.lockAnki(() => store.withSyncConnection((db) => undoAnkiAction(db, action.anki!, now)));
    if (!done) return null;
  }
  const byId = new Map(live.map((c) => [c.id, c]));
  const restored = action.before.map((b) => restoreCard(byId.get(b.id) ?? b, b, action.kind));
  for (const c of restored) await store.saveCard(c);
  return restored;
}
