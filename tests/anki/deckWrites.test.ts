import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ankiCollapsedDecks, setAnkiDeckCollapsed } from '../../src/anki/deckWrites';
import { deckJson } from '../../src/anki/sync/deckRows';
import { nodeSyncDb } from '../support/syncDb';

const FIXTURE = join(__dirname, '..', 'fixtures', 'anki', 'collection.anki2');
const NOW = new Date(2026, 10, 11, 12);

async function kept() {
  const dir = mkdtempSync(join(tmpdir(), 'deckwrites-'));
  copyFileSync(FIXTURE, join(dir, 'collection.anki2'));
  // Without Anki's collation, as on a build made before the module: a deck's flag is written all the same.
  return nodeSyncDb(join(dir, 'collection.anki2'));
}

describe("a deck's collapsed state in the kept collection", () => {
  it("starts with Anki's own state, which is collapsed for every deck Anki makes (Deck::new_normal)", async () => {
    const db = await kept();
    expect(await ankiCollapsedDecks(db)).toEqual(new Set(['Default', '👅 Languages', '👅 Languages::🐘 ภาษาไทย', '🧠 Trivia', 'Filtered Deck 1']));
    db.close();
  });

  it("expands and collapses a deck as Anki does: only the flag changes, and it's marked to send", async () => {
    const db = await kept();
    const before = (await db.first<any>('SELECT * FROM decks NOT INDEXED WHERE id = 1794408857989'))!;
    expect(await setAnkiDeckCollapsed(db, '👅 Languages', false, NOW)).toBe(true);
    expect((await ankiCollapsedDecks(db)).has('👅 Languages')).toBe(false);
    const after = (await db.first<any>('SELECT * FROM decks NOT INDEXED WHERE id = 1794408857989'))!;
    expect([after.usn, after.mtime_secs, after.kind]).toEqual([-1, Math.floor(NOW.getTime() / 1000), before.kind]);
    const row = (r: any) => ({ id: r.id, name: r.name, mtime: r.mtime_secs, usn: r.usn, common: r.common, kind: r.kind });
    expect(deckJson(row(after))).toEqual({ ...deckJson(row(before)), collapsed: false, mod: after.mtime_secs, usn: -1 });
    expect((await db.first<{ mod: number }>('SELECT mod FROM col'))!.mod).toBe(NOW.getTime());
    await setAnkiDeckCollapsed(db, '👅 Languages', true, NOW);
    expect((await ankiCollapsedDecks(db)).has('👅 Languages')).toBe(true);
    db.close();
  });

  it("says when Anki has no such deck, and leaves a deck already in that state alone", async () => {
    const db = await kept();
    expect(await setAnkiDeckCollapsed(db, 'Nope', true, NOW)).toBe(false);
    const trivia = () => db.first<{ mtime_secs: number; common: Uint8Array }>('SELECT mtime_secs, common FROM decks NOT INDEXED WHERE id = 1794408857991');
    const before = await trivia();
    expect(await setAnkiDeckCollapsed(db, '🧠 Trivia', true, NOW)).toBe(true);
    expect(await trivia()).toEqual(before);
    db.close();
  });
});
