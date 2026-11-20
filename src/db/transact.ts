import type * as SQLite from 'expo-sqlite';
import { WriteQueue } from '../core/writeQueue';

/**
 * A transaction on the app's one database connection, run after any other has finished.
 *
 * expo-sqlite's `withTransactionAsync` isn't exclusive: a second one started on the same connection
 * while the first is open fails at its BEGIN ("cannot start a transaction within a transaction"),
 * and its own catch then runs ROLLBACK, which rolls back the first one's work. A note saved in the
 * background while an answer was being written could lose the answer that way. Queued here, each
 * waits for the one before it, whether that one worked or threw.
 *
 * `work` must not call `transact` itself (it would wait for itself). Every transaction on the
 * connection `openRepo` opens goes through this (tests/noBareTransaction.test.ts); a connection
 * opened for one job and closed after it (the kept collection's, sync's) has no one to collide with.
 */
const queues = new WeakMap<SQLite.SQLiteDatabase, WriteQueue>();

export function transact(db: SQLite.SQLiteDatabase, work: () => Promise<void>): Promise<void> {
  let queue = queues.get(db);
  if (!queue) queues.set(db, (queue = new WriteQueue()));
  return queue.add(() => db.withTransactionAsync(work));
}
