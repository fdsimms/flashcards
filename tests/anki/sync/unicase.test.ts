import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sqliteWithUnicase, unicaseExtension } from '../../support/unicase';

/**
 * The collation the app registers (modules/anki-unicase) against the order Anki's own collation
 * puts the same strings in (sync-fixtures.json, from make-sync-fixtures.py): every character
 * with a case folding, what it folds to, and words with multi-character folds. Ties are broken by
 * the strings' bytes on both sides, so equal-under-the-collation shows up too.
 */
const fixtures = JSON.parse(readFileSync(join(__dirname, '..', '..', 'fixtures', 'anki', 'sync-fixtures.json'), 'utf8')) as { unicase: string[] };

describe.skipIf(!unicaseExtension())('Anki\'s unicase collation, as the app registers it', () => {
  it('sorts as Anki does', async () => {
    const db = await sqliteWithUnicase(':memory:');
    db.exec('CREATE TABLE t (x TEXT)');
    const insert = db.prepare('INSERT INTO t VALUES (?)');
    for (const x of [...fixtures.unicase].reverse()) insert.run(x);
    const ours = (db.prepare('SELECT x FROM t ORDER BY x COLLATE unicase, x').all() as { x: string }[]).map((r) => r.x);
    expect(ours).toEqual(fixtures.unicase);
    db.close();
  });

  it('matches equal names however they\'re cased, as Anki\'s unique indexes do', async () => {
    const db = await sqliteWithUnicase(':memory:');
    db.exec('CREATE TABLE decks (name TEXT NOT NULL COLLATE unicase); CREATE UNIQUE INDEX n ON decks (name)');
    db.prepare('INSERT INTO decks VALUES (?)').run('Polski::Odmiana');
    expect(() => db.prepare('INSERT INTO decks VALUES (?)').run('POLSKI::odmiana')).toThrow(/UNIQUE/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM decks WHERE name = 'polski::ODMIANA'").get()).toEqual({ n: 1 });
    db.close();
  });
});
