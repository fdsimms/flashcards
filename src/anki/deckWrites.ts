import { decodeMessage, uint } from './protobuf';
import type { SyncDb } from './sync/collectionSync';
import { deckCommon, deckJson } from './sync/deckRows';
import { COL_MODIFIED_SQL } from './writeback';

/**
 * Anki's own collapsed state for the deck list (`Deck.Common.study_collapsed`, not the browser
 * sidebar's), read from and written to the kept collection, so collapsing a deck here collapses
 * it in Anki after a sync and the other way around. Decks are read by scanning the table
 * (`NOT INDEXED`): a lookup by name needs Anki's collation, and only the name index uses it.
 */

const STUDY_COLLAPSED = 1;
const humanName = (native: string) => native.split('\x1f').join('::');

/** The decks collapsed in Anki's deck list, by name ("A::B"). */
export async function ankiCollapsedDecks(db: SyncDb): Promise<Set<string>> {
  const rows = await db.all<{ name: string; common: Uint8Array }>('SELECT name, common FROM decks NOT INDEXED');
  return new Set(rows.filter((r) => uint(decodeMessage(r.common), STUDY_COLLAPSED) === 1).map((r) => humanName(r.name)));
}

/**
 * Collapses or expands a deck as Anki's set_deck_collapsed does: `common` re-encoded with the flag
 * changed, the deck's mtime and usn -1, and the collection's modified stamp, so sync sends it
 * (`applyChanges`). False when Anki has no deck by that name.
 */
export async function setAnkiDeckCollapsed(db: SyncDb, name: string, collapsed: boolean, now: Date): Promise<boolean> {
  const native = name.split('::').join('\x1f');
  const rows = await db.all<{ id: number; name: string; mtime_secs: number; usn: number; common: Uint8Array; kind: Uint8Array }>(
    'SELECT id, name, mtime_secs, usn, common, kind FROM decks NOT INDEXED',
  );
  const row = rows.find((r) => r.name === native);
  if (!row) return false;
  const json = deckJson({ id: Number(row.id), name: row.name, mtime: row.mtime_secs, usn: row.usn, common: row.common, kind: row.kind });
  if (json.collapsed === collapsed) return true;
  await db.transaction(async () => {
    await db.run('UPDATE decks SET common = ?, mtime_secs = ?, usn = -1 WHERE id = ?', deckCommon({ ...json, collapsed }), Math.floor(now.getTime() / 1000), row.id);
    await db.run(COL_MODIFIED_SQL, now.getTime());
  });
  return true;
}
