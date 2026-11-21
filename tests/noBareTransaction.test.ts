/**
 * Every transaction on the app's own database connection goes through `transact`
 * (src/db/transact.ts), which runs them one at a time.
 *
 * expo-sqlite's `withTransactionAsync` isn't exclusive: a second one started on the same
 * connection while the first is open fails, and its rollback takes the first one's work with it.
 * The connection `openRepo` opens is called `db` everywhere it's passed; a connection opened for
 * one job and closed after it (`conn`, the kept collection's and sync's) is used by that job alone.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');
const BARE = /\bdb\.withTransactionAsync\(/;
const HELPER = 'src/db/transact.ts';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(name) ? [p] : [];
  });
}

describe('transactions outside transact', () => {
  it('matches what it is meant to catch', () => {
    expect(BARE.test('await db.withTransactionAsync(async () => {')).toBe(true);
    expect(BARE.test('await transact(db, async () => {')).toBe(false);
    expect(BARE.test('transaction: (work) => conn.withTransactionAsync(work),')).toBe(false);
  });

  it('finds none in src/ but the helper itself', () => {
    const hits = sourceFiles(SRC)
      .map((f) => relative(ROOT, f).split('\\').join('/'))
      .filter((f) => f !== HELPER && BARE.test(readFileSync(join(ROOT, f), 'utf8')));
    expect(hits).toEqual([]);
    expect(BARE.test(readFileSync(join(ROOT, HELPER), 'utf8'))).toBe(true);
  });
});
