import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COLLECTION_QUERIES, STRIP_UNICASE_SQL, type CollectionRows } from '../../src/anki/collection';

/**
 * A collection's rows read the way the phone reads them: on a scratch copy with Anki's unicase
 * collation stripped from the schema, running `COLLECTION_QUERIES`.
 */
export async function readCollectionRows(path: string): Promise<CollectionRows> {
  const { DatabaseSync } = await import('node:sqlite');
  const dir = mkdtempSync(join(tmpdir(), 'rows-'));
  try {
    const copy = join(dir, 'c.anki2');
    copyFileSync(path, copy);
    const rw = new DatabaseSync(copy);
    rw.exec('PRAGMA writable_schema = ON');
    rw.exec(STRIP_UNICASE_SQL);
    rw.close();
    const db = new DatabaseSync(copy, { readOnly: true });
    const all = (sql: string) => db.prepare(sql).all() as any[];
    const rows: CollectionRows = {
      col: db.prepare(COLLECTION_QUERIES.col).get() as any,
      notetypes: all(COLLECTION_QUERIES.notetypes),
      fields: all(COLLECTION_QUERIES.fields),
      templates: all(COLLECTION_QUERIES.templates),
      notes: all(COLLECTION_QUERIES.notes),
      cards: all(COLLECTION_QUERIES.cards),
      decks: all(COLLECTION_QUERIES.decks),
      deckConfigs: all(COLLECTION_QUERIES.deckConfigs),
      lastReviews: all(COLLECTION_QUERIES.lastReviews),
    };
    db.close();
    return rows;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
