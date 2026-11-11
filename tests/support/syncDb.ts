import type { HttpPost } from '../../src/anki/sync/client';
import type { SqlValue, SyncDb } from '../../src/anki/sync/collectionSync';
import { sqliteWithUnicase } from './unicase';

/**
 * The app's SyncDb over Node's SQLite: one connection to a collection file, as on the phone.
 * `unicase`: with Anki's collation loaded, as on a phone whose build has modules/anki-unicase.
 */
export async function nodeSyncDb(path: string, opts: { unicase?: boolean } = {}): Promise<SyncDb & { close(): void }> {
  const { DatabaseSync } = await import('node:sqlite');
  const db = opts.unicase ? await sqliteWithUnicase(path) : new DatabaseSync(path);
  const params = (p: SqlValue[]) => p as (string | number | null | Uint8Array)[];
  return {
    async all<T>(sql: string, ...p: SqlValue[]) { return db.prepare(sql).all(...params(p)) as T[]; },
    async first<T>(sql: string, ...p: SqlValue[]) { return (db.prepare(sql).get(...params(p)) as T | undefined) ?? null; },
    async run(sql: string, ...p: SqlValue[]) { db.prepare(sql).run(...params(p)); },
    async transaction(fn) {
      db.exec('BEGIN');
      try { await fn(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    close: () => db.close(),
  };
}

/** HttpPost over Node's fetch. */
export const nodePost: HttpPost = async (url, headers, body) => {
  const r = await fetch(url, { method: 'POST', headers, body: new Uint8Array(body) });
  const reader = r.body?.getReader();
  return {
    status: r.status,
    async read() {
      if (!reader) return null;
      const { value, done } = await reader.read();
      return done ? null : value;
    },
  };
};
