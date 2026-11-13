import { STRIP_UNICASE_SQL } from './collection';
import { BURY_CARD_SQL, CARD_ROW_SQL, CARD_STATE_SQL, CARD_STATE_UPDATE_SQL, CARD_UPDATE_SQL, COL_MODIFIED_SQL, REVLOG_INSERT_SQL } from './writeback';

/**
 * The SQL the app runs against an Anki collection attached to its own connection under a schema
 * name (`anki` for the kept one, `scratch` for a copy being read): the same statements as
 * collection.ts and writeback.ts, pointed at that schema. Pure, so tests run exactly these
 * strings with Node's SQLite.
 */

/** A read (`SELECT ... FROM table`) against an attached schema. */
export function inSchema(sql: string, schema: string): string {
  return sql.replace(/\bFROM (\w+)/g, `FROM ${schema}.$1`);
}

/** Strips Anki's collation from an attached scratch copy; run between writable_schema ON and OFF. */
export function stripUnicaseIn(schema: string): string {
  return STRIP_UNICASE_SQL.replace('UPDATE sqlite_master', `UPDATE ${schema}.sqlite_master`);
}

export const keptSql = (schema = 'anki') => ({
  cardRow: inSchema(CARD_ROW_SQL, schema),
  cardUpdate: CARD_UPDATE_SQL.replace('UPDATE cards', `UPDATE ${schema}.cards`),
  buryCard: BURY_CARD_SQL.replace('UPDATE cards', `UPDATE ${schema}.cards`),
  cardState: inSchema(CARD_STATE_SQL, schema),
  cardStateUpdate: CARD_STATE_UPDATE_SQL.replace('UPDATE cards', `UPDATE ${schema}.cards`),
  revlogInsert: REVLOG_INSERT_SQL.replace('INSERT INTO revlog', `INSERT INTO ${schema}.revlog`),
  revlogDelete: `DELETE FROM ${schema}.revlog WHERE id = ?`,
  maxRevlogId: `SELECT MAX(id) AS m FROM ${schema}.revlog`,
  crt: `SELECT crt FROM ${schema}.col`,
  colModified: COL_MODIFIED_SQL.replace('UPDATE col', `UPDATE ${schema}.col`),
  unsentSince: `SELECT COUNT(*) AS n FROM ${schema}.revlog WHERE id > ? AND usn = -1`,
  // Changes made here and not on the server yet, besides answers: notes added, edited or deleted,
  // cards suspended, buried, flagged or deleted, decks made, renamed, collapsed or studied in. A sync sets their
  // usn; only a full download drops them. (Decks NOT INDEXED: their name index needs Anki's collation.)
  unsentEdits: `SELECT (SELECT COUNT(*) FROM ${schema}.notes WHERE usn = -1)`
    + ` + (SELECT COUNT(*) FROM ${schema}.graves WHERE usn = -1)`
    + ` + (SELECT COUNT(*) FROM ${schema}.decks NOT INDEXED WHERE usn = -1)`
    + ` + (SELECT COUNT(*) FROM ${schema}.cards WHERE usn = -1 AND id NOT IN (SELECT cid FROM ${schema}.revlog WHERE usn = -1)) AS n`,
  revlogUsn: `SELECT usn FROM ${schema}.revlog WHERE id = ?`,
  revlogSince: `SELECT id, cid, ease, lastIvl, time, type FROM ${schema}.revlog WHERE id >= ? ORDER BY id`,
  // Every deck, for the deck list, which shows a deck with no cards too. Read by scanning, so no collation is needed.
  decks: `SELECT id, name FROM ${schema}.decks NOT INDEXED`,
  // An answer's "studied today" counts (deckStats.ts). Only `common` and the stamps change, which no index covers.
  deckStats: `SELECT id, name, mtime_secs, usn, common FROM ${schema}.decks NOT INDEXED`,
  deckStatsUpdate: `UPDATE ${schema}.decks SET common = ?, mtime_secs = ?, usn = ? WHERE id = ?`,
});
