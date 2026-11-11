import { STRIP_UNICASE_SQL } from './collection';
import { CARD_ROW_SQL, CARD_UPDATE_SQL, COL_MODIFIED_SQL, REVLOG_INSERT_SQL } from './writeback';

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
  revlogInsert: REVLOG_INSERT_SQL.replace('INSERT INTO revlog', `INSERT INTO ${schema}.revlog`),
  revlogDelete: `DELETE FROM ${schema}.revlog WHERE id = ?`,
  maxRevlogId: `SELECT MAX(id) AS m FROM ${schema}.revlog`,
  crt: `SELECT crt FROM ${schema}.col`,
  colModified: COL_MODIFIED_SQL.replace('UPDATE col', `UPDATE ${schema}.col`),
  unsentSince: `SELECT COUNT(*) AS n FROM ${schema}.revlog WHERE id > ? AND usn = -1`,
  revlogUsn: `SELECT usn FROM ${schema}.revlog WHERE id = ?`,
});
