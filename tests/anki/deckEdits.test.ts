import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addAnkiDeck, ankiDeckDeletion, DeckRefused, removeAnkiDeck, renameAnkiDeck } from '../../src/anki/deckEdits';
import vectors from '../fixtures/anki/deck-vectors.json';
import { nodeSyncDb } from '../support/syncDb';

const FIXTURE = join(__dirname, '..', 'fixtures', 'anki', 'collection.anki2');
const NOW = new Date(2026, 10, 12, 9);

async function kept(unicase = true) {
  const dir = mkdtempSync(join(tmpdir(), 'deckedits-'));
  copyFileSync(FIXTURE, join(dir, 'collection.anki2'));
  return nodeSyncDb(join(dir, 'collection.anki2'), { unicase });
}
type Db = Awaited<ReturnType<typeof kept>>;

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const human = (native: string) => native.split('\x1f').join('::');

/** What tests/fixtures/anki/make-deck-vectors.py records, taken the same way from a collection Franki wrote. */
async function snapshot(db: Db, before: { decks: Map<number, number>; cards: Map<number, number>; mod: number }, newIds: number[]) {
  const key = (id: number) => (newIds.includes(id) ? `new ${newIds.indexOf(id)}` : id);
  const decks = await db.all<any>('SELECT id, name, mtime_secs, usn, common, kind FROM decks NOT INDEXED ORDER BY id');
  const names = new Map(decks.map((d) => [Number(d.id), d.name as string]));
  const deckName = (id: number) => (names.has(id) ? human(names.get(id)!) : id === 0 ? null : `gone ${id}`);
  return {
    decks: decks.map((d) => ({
      id: key(Number(d.id)), name: human(d.name), common: hex(d.common), kind: hex(d.kind), usn: d.usn,
      changed: newIds.includes(Number(d.id)) || before.decks.get(Number(d.id)) !== d.mtime_secs,
    })),
    graves: (await db.all<any>('SELECT oid, type, usn FROM graves ORDER BY type, oid')).map((g) => ({ oid: g.type === 2 ? key(Number(g.oid)) : g.oid, type: g.type, usn: g.usn })),
    cards: (await db.all<any>('SELECT id, did, odid, queue, due, odue, usn, mod FROM cards ORDER BY id')).map((c) => ({
      id: c.id, deck: deckName(Number(c.did)), home: deckName(Number(c.odid)), queue: c.queue, due: c.due, odue: c.odue, usn: c.usn,
      changed: before.cards.get(Number(c.id)) !== c.mod,
    })),
    notes: (await db.all<any>('SELECT id, usn FROM notes ORDER BY id')).map((n) => ({ id: n.id, usn: n.usn })),
    config: (await db.all<{ key: string }>('SELECT KEY AS key FROM config')).map((r) => r.key).sort(),
    modified: (await db.first<{ mod: number }>('SELECT mod FROM col'))!.mod !== before.mod,
  };
}

describe('decks made, renamed and deleted as Anki does it (tests/fixtures/anki/deck-vectors.json)', () => {
  for (const v of vectors) {
    it(v.name, async () => {
      const db = await kept();
      const before = {
        decks: new Map((await db.all<any>('SELECT id, mtime_secs FROM decks NOT INDEXED')).map((d) => [Number(d.id), d.mtime_secs])),
        cards: new Map((await db.all<any>('SELECT id, mod FROM cards')).map((c) => [Number(c.id), c.mod])),
        mod: (await db.first<{ mod: number }>('SELECT mod FROM col'))!.mod,
      };
      const newIds: number[] = [];
      // A minute apart, so each step's mtimes differ from the last's.
      let step = 0;
      for (const [op, a, b] of v.steps as [string, string, string?][]) {
        const now = new Date(NOW.getTime() + 60_000 * step++);
        if (op === 'create') await addAnkiDeck(db, a, now);
        else if (op === 'rename') expect(await renameAnkiDeck(db, a, b!, now)).not.toBeNull();
        else expect(await removeAnkiDeck(db, a, now)).not.toBeNull();
        const ids = (await db.all<{ id: number }>('SELECT id FROM decks NOT INDEXED')).map((d) => Number(d.id));
        newIds.push(...ids.filter((id) => !before.decks.has(id) && !newIds.includes(id)).sort((x, y) => x - y));
      }
      expect(await snapshot(db, before, newIds)).toEqual(v.after);
      db.close();
    });
  }
});

describe('making a deck', () => {
  it('gives it an id from the time, or one past the largest when that is taken', async () => {
    const db = await kept();
    await addAnkiDeck(db, 'One', NOW);
    await addAnkiDeck(db, 'Two', NOW);
    const ids = await db.all<{ id: number; name: string }>("SELECT id, name FROM decks NOT INDEXED WHERE name IN ('One', 'Two') ORDER BY id");
    expect(ids).toEqual([{ id: NOW.getTime(), name: 'One' }, { id: NOW.getTime() + 1, name: 'Two' }]);
    db.close();
  });

  it('refuses a name Anki already has, whatever its case, and a deck inside a filtered deck', async () => {
    const db = await kept();
    await expect(addAnkiDeck(db, '🧠 TRIVIA', NOW)).rejects.toThrow(new DeckRefused('A deck called "🧠 Trivia" already exists.'));
    await expect(addAnkiDeck(db, 'filtered deck 1::Inside', NOW)).rejects.toThrow(/"Filtered Deck 1" is a filtered deck/);
    // Nothing was written: no parent made on the way.
    expect((await db.all('SELECT id FROM decks NOT INDEXED WHERE usn = -1 AND mtime_secs = ?', Math.floor(NOW.getTime() / 1000)))).toEqual([]);
    db.close();
  });

  it('is refused without Anki\'s collation, which the deck table needs', async () => {
    const db = await kept(false);
    await expect(addAnkiDeck(db, 'Nowy', NOW)).rejects.toThrow(/can't add a deck/);
    db.close();
  });
});

describe('renaming a deck', () => {
  it('is null for a deck Anki does not have, and changes nothing when the name is the same', async () => {
    const db = await kept();
    expect(await renameAnkiDeck(db, 'Nope', 'Other', NOW)).toBeNull();
    expect(await renameAnkiDeck(db, '🧠 Trivia', '🧠 Trivia', NOW)).toBe('🧠 Trivia');
    expect((await db.first<any>('SELECT mtime_secs FROM decks WHERE id = 1794408857991')).mtime_secs).not.toBe(Math.floor(NOW.getTime() / 1000));
    db.close();
  });

  it('refuses a name another deck has, and a name inside the deck itself', async () => {
    const db = await kept();
    await expect(renameAnkiDeck(db, '🧠 Trivia', 'filtered deck 1', NOW)).rejects.toThrow('A deck called "Filtered Deck 1" already exists.');
    await expect(renameAnkiDeck(db, '👅 Languages', '👅 LANGUAGES::Sub', NOW)).rejects.toThrow("A deck can't go inside itself.");
    db.close();
  });

  it('returns the name as stored, with an existing parent\'s spelling', async () => {
    const db = await kept();
    expect(await renameAnkiDeck(db, '🧠 Trivia', '👅 languages::Trivia', NOW)).toBe('👅 Languages::Trivia');
    db.close();
  });
});

describe('deleting a deck', () => {
  it('says how many cards go with it, those studied in a filtered deck included', async () => {
    const db = await kept();
    expect(await ankiDeckDeletion(db, '🧠 Trivia')).toEqual({ cards: 6, keepsDeck: false });
    expect(await ankiDeckDeletion(db, '👅 Languages')).toEqual({ cards: 4, keepsDeck: false });
    expect(await ankiDeckDeletion(db, 'Filtered Deck 1')).toEqual({ cards: 0, keepsDeck: false });
    expect(await ankiDeckDeletion(db, 'Default')).toEqual({ cards: 0, keepsDeck: true });
    expect(await ankiDeckDeletion(db, 'Nope')).toBeNull();
    expect(await removeAnkiDeck(db, 'Nope', NOW)).toBeNull();
    expect(await removeAnkiDeck(db, '🧠 Trivia', NOW)).toBe(6);
    db.close();
  });

  it('keeps the Default deck, named Default again, past a deck already called that', async () => {
    const db = await kept();
    await renameAnkiDeck(db, 'Default', 'Main', NOW);
    await addAnkiDeck(db, 'default', NOW);
    await removeAnkiDeck(db, 'Main', NOW);
    expect((await db.first<{ name: string }>('SELECT name FROM decks WHERE id = 1'))!.name).toBe('Default+');
    expect(await db.all('SELECT * FROM graves WHERE type = 2')).toEqual([]);
    db.close();
  });
});
