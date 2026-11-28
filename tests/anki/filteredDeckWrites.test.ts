import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deckName } from '../../src/anki/collection';
import { DeckRefused } from '../../src/anki/deckService';
import { emptyAnkiFilteredDeck, readFilteredDeck, rebuildAnkiFilteredDeck, saveFilteredDeck } from '../../src/anki/filteredDeckWrites';
import { newFilteredDeck } from '../../src/core/filteredDeck';
import { nodeSyncDb } from '../support/syncDb';

const FIXTURES = join(__dirname, '..', 'fixtures', 'anki');
const NOW = new Date(2026, 10, 11, 12);

/** What Anki 26.09 built for each case (make-filtered-vectors.py). */
interface Vector {
  name: string;
  terms: [string, number, number][];
  reschedule: boolean;
  then: 'rebuild' | 'empty' | null;
  setup: string[];
  deckName: string;
  today: number;
  nextDayAt: number;
  now: number;
  learnAheadSecs: number;
  error: string | null;
  cards: { id: number; deck: string; home: string | null; type: number; queue: number; due: number; odue: number }[];
}
const VECTORS: Vector[] = JSON.parse(readFileSync(join(FIXTURES, 'filtered-vectors.json'), 'utf8'));

async function kept(v: Vector) {
  const dir = mkdtempSync(join(tmpdir(), 'filtered-'));
  copyFileSync(join(FIXTURES, 'collection.anki2'), join(dir, 'collection.anki2'));
  const db = await nodeSyncDb(join(dir, 'collection.anki2'), { unicase: true });
  for (const sql of v.setup) await db.run(sql);
  return db;
}

async function cardsOf(db: Awaited<ReturnType<typeof nodeSyncDb>>) {
  const decks = new Map((await db.all<{ id: number; name: string }>('SELECT id, name FROM decks NOT INDEXED')).map((d) => [Number(d.id), deckName(d.name)]));
  return (await db.all<any>('SELECT id, did, odid, odue, type, queue, due FROM cards ORDER BY id')).map((c) => ({
    id: Number(c.id), deck: decks.get(Number(c.did)), home: c.odid ? decks.get(Number(c.odid)) ?? null : null,
    type: c.type, queue: c.queue, due: c.due, odue: c.odue,
  }));
}

describe('a filtered deck built in the kept collection, as Anki builds it', () => {
  for (const v of VECTORS) {
    it(v.name, async () => {
      const db = await kept(v);
      const timing = { today: v.today, nextDayAt: v.nextDayAt, now: v.now, learnAheadSecs: v.learnAheadSecs };
      const config = { ...newFilteredDeck(), name: v.deckName, terms: v.terms.map(([search, limit, order]) => ({ search, limit, order })), reschedule: v.reschedule };
      const before = await cardsOf(db);
      const build = saveFilteredDeck(db, { config, timing, knownFields: new Map(), now: NOW });
      if (v.error) {
        await expect(build).rejects.toBeInstanceOf(DeckRefused);
        expect(await cardsOf(db)).toEqual(before);
        expect((await db.all<{ name: string }>('SELECT name FROM decks NOT INDEXED')).map((d) => deckName(d.name))).not.toContain(v.deckName);
        db.close();
        return;
      }
      const { id } = await build;
      if (v.then === 'rebuild') await rebuildAnkiFilteredDeck(db, id, timing, new Map(), NOW);
      if (v.then === 'empty') await emptyAnkiFilteredDeck(db, id, NOW);
      expect(await cardsOf(db)).toEqual(v.cards);
      db.close();
    });
  }

  it('keeps its searches, limits, orders and rescheduling, and edits them in place', async () => {
    const v = VECTORS[0];
    const db = await kept(v);
    const timing = { today: v.today, nextDayAt: v.nextDayAt, now: v.now, learnAheadSecs: v.learnAheadSecs };
    const made = await saveFilteredDeck(db, { config: { ...newFilteredDeck('is:new'), name: 'Mine' }, timing, knownFields: new Map(), now: NOW });
    expect((await readFilteredDeck(db, made.id))!.config).toMatchObject({ name: 'Mine', terms: [{ search: 'is:new', limit: 100, order: 1 }], reschedule: true });
    const edited = await saveFilteredDeck(db, {
      deckId: made.id, config: { ...newFilteredDeck(), name: 'Mine again', terms: [{ search: 'is:review', limit: 5, order: 6 }, { search: 'is:new', limit: 2, order: 5 }], reschedule: false },
      timing, knownFields: new Map(), now: NOW,
    });
    expect(edited.id).toBe(made.id);
    expect((await readFilteredDeck(db, made.id))!.config).toMatchObject({ name: 'Mine again', terms: [{ search: 'is:review', limit: 5, order: 6 }, { search: 'is:new', limit: 2, order: 5 }], reschedule: false });
    // Taken by a normal deck: refused, and the deck is as it was.
    await expect(saveFilteredDeck(db, { deckId: made.id, config: { ...newFilteredDeck('is:new'), name: '🧠 Trivia' }, timing, knownFields: new Map(), now: NOW })).rejects.toThrow('already exists');
    db.close();
  });
});
