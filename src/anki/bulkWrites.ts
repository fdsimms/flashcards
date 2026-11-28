import { repositionPositions } from '../core/browseActions';
import { readCardRows, type AnkiActionUndo } from './cardUndo';
import { canonicalTags } from './noteWrites';
import { hasUnicase, type SyncDb } from './sync/collectionSync';
import { COL_MODIFIED_SQL, queueForType } from './writeback';

/**
 * What Browse's Select mode writes into the kept collection beyond what Review's menu already does
 * (`setAnkiCardStatesUndoable`, rescheduleWrites.ts): tags, a change of deck and Reposition, each as
 * Anki writes it, rows with usn -1 and the collection stamped modified, in one transaction, and each
 * returning what undoes it (`undoAnkiAction`).
 */

/**
 * Sets each note's tags (`tagsOf` the note's id gives them, as Anki's add_tags_to_notes and
 * remove_tags_from_notes leave them), for the notes whose tags change. Notes are by Anki id.
 */
export async function setAnkiNoteTags(db: SyncDb, tagsOf: Map<number, string[]>, now: Date): Promise<AnkiActionUndo> {
  const notes: NonNullable<AnkiActionUndo['notes']> = [];
  const secs = Math.floor(now.getTime() / 1000);
  await db.transaction(async () => {
    const collated = await hasUnicase(db);
    for (const [nid, tags] of tagsOf) {
      const row = await db.first<{ tags: string; mod: number; usn: number }>('SELECT tags, mod, usn FROM notes WHERE id = ?', nid);
      if (!row) continue;
      const next = await canonicalTags(db, tags, collated);
      if (next === row.tags) continue;
      notes.push({ nid, tags: row.tags, mod: row.mod, usn: row.usn });
      await db.run('UPDATE notes SET tags = ?, mod = ?, usn = -1 WHERE id = ?', next, secs, nid);
    }
    if (notes.length) await db.run(COL_MODIFIED_SQL, now.getTime());
  });
  return { cards: [], revlogIds: [], config: [], notes };
}

/**
 * Moves the notes' cards to the deck `deckId`, as Anki's Change Deck does (`Card::set_deck`): a card
 * in a filtered deck is first taken out of it, back to its home due and queue.
 */
export async function moveAnkiNotesUndoable(db: SyncDb, nids: number[], deckId: number, now: Date): Promise<AnkiActionUndo> {
  const nowSecs = Math.floor(now.getTime() / 1000);
  let cards: AnkiActionUndo['cards'] = [];
  await db.transaction(async () => {
    const ids: number[] = [];
    for (const nid of nids) for (const c of await db.all<{ id: number }>('SELECT id FROM cards WHERE nid = ?', nid)) ids.push(Number(c.id));
    cards = (await readCardRows(db, ids)).filter((r) => r.did !== deckId || r.odid !== 0);
    for (const r of cards) {
      if (r.odid) {
        const due = r.odue !== 0 ? r.odue : r.due;
        const queue = r.queue >= 0 ? queueForType(r.type, due) : r.queue;
        await db.run('UPDATE cards SET did = ?, odid = 0, odue = 0, due = ?, queue = ?, mod = ?, usn = -1 WHERE id = ?', deckId, due, queue, nowSecs, r.cid);
      } else {
        await db.run('UPDATE cards SET did = ?, mod = ?, usn = -1 WHERE id = ?', deckId, nowSecs, r.cid);
      }
    }
    if (cards.length) await db.run(COL_MODIFIED_SQL, now.getTime());
  });
  return { cards, revlogIds: [], config: [] };
}

/**
 * Anki's Reposition (rslib's `sort_cards` from the browser): the new cards among `cids`, a position
 * per note from `start` in steps, in the order given or shuffled; with `shift`, every new card at or
 * past `start` first moves on by the step times the number of cards. A new card in a filtered deck
 * keeps its place there and takes the position as its home due. Returns the new position of every
 * card it moved (those shifted along too) by card id, and what undoes it.
 */
export async function repositionAnkiCards(
  db: SyncDb, cids: number[], o: { start: number; step: number; randomize: boolean; shift: boolean }, now: Date, random?: () => number,
): Promise<{ positions: Map<number, number>; undo: AnkiActionUndo }> {
  const nowSecs = Math.floor(now.getTime() / 1000);
  const positions = new Map<number, number>();
  let cards: AnkiActionUndo['cards'] = [];
  await db.transaction(async () => {
    const rows = new Map((await db.all<{ id: number; nid: number }>(`SELECT id, nid FROM cards WHERE id IN (${cids.map(Number).join(',') || 'NULL'})`)).map((r) => [Number(r.id), Number(r.nid)]));
    const picked = cids.filter((c) => rows.has(c));
    const shifted = o.shift
      ? (await db.all<{ id: number }>('SELECT id FROM cards WHERE due >= ? AND type = 0', o.start)).map((r) => Number(r.id))
      : [];
    cards = await readCardRows(db, [...new Set([...shifted, ...picked])]);
    const byCid = new Map(cards.map((r) => [r.cid, r]));
    const setPosition = async (cid: number, pos: number) => {
      const r = byCid.get(cid)!;
      // As Anki's set_new_position: a new card's due (its home due in a filtered deck), or a card in the new queue.
      if (r.type === 0 && r.odid) await db.run('UPDATE cards SET odue = ?, mod = ?, usn = -1 WHERE id = ?', pos, nowSecs, cid);
      else if (r.type === 0 || r.queue === 0) await db.run('UPDATE cards SET due = ?, mod = ?, usn = -1 WHERE id = ?', pos, nowSecs, cid);
      else return false;
      return true;
    };
    const by = o.step * picked.length;
    for (const cid of shifted) {
      const pos = byCid.get(cid)!.due + by;
      if (await setPosition(cid, pos)) positions.set(cid, pos);
    }
    const order = repositionPositions(picked.map((c) => String(rows.get(c))), o.start, o.step, o.randomize, random);
    for (const cid of picked) {
      const pos = order.get(String(rows.get(cid)))!;
      if (await setPosition(cid, pos)) positions.set(cid, pos);
    }
    await db.run(COL_MODIFIED_SQL, now.getTime());
  });
  return { positions, undo: { cards, revlogIds: [], config: [] } };
}
