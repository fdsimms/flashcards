import type * as SQLite from 'expo-sqlite';
import { describe, expect, it } from 'vitest';
import { transact } from '../../src/db/transact';

/** A connection that, like expo-sqlite's, fails a transaction begun while another is open. */
function fakeDb() {
  let open = false;
  const log: string[] = [];
  const db = {
    async withTransactionAsync(work: () => Promise<void>) {
      if (open) throw new Error('cannot start a transaction within a transaction');
      open = true;
      try {
        await work();
      } finally {
        open = false;
      }
    },
  } as unknown as SQLite.SQLiteDatabase;
  return { db, log };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('transact', () => {
  it('runs transactions started together one after the other', async () => {
    const { db, log } = fakeDb();
    const one = transact(db, async () => { log.push('a1'); await tick(); log.push('a2'); });
    const two = transact(db, async () => { log.push('b1'); await tick(); log.push('b2'); });
    await Promise.all([one, two]);
    expect(log).toEqual(['a1', 'a2', 'b1', 'b2']);
  });

  it('gives each caller its own failure and runs the next all the same', async () => {
    const { db, log } = fakeDb();
    const one = transact(db, async () => { throw new Error('first failed'); });
    const two = transact(db, async () => { log.push('second'); });
    await expect(one).rejects.toThrow('first failed');
    await two;
    expect(log).toEqual(['second']);
  });

  it('keeps a queue per connection', async () => {
    const [a, b] = [fakeDb(), fakeDb()];
    const slow = transact(a.db, async () => { await tick(); a.log.push('a'); });
    await transact(b.db, async () => { b.log.push('b'); });
    expect(a.log).toEqual([]);
    await slow;
    expect(a.log).toEqual(['a']);
  });
});
