import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { moveAnkiNotesUndoable, repositionAnkiCards, setAnkiNoteTags } from '../../src/anki/bulkWrites';
import { undoAnkiAction } from '../../src/anki/cardUndo';
import { deckName } from '../../src/anki/collection';
import { withTagsAdded, withTagsRemoved } from '../../src/core/browseActions';
import { nodeSyncDb } from '../support/syncDb';

const FIXTURES = join(__dirname, '..', 'fixtures', 'anki');
const NOW = new Date(2026, 10, 11, 12);

/** What Anki 26.09 wrote for each case (make-bulk-vectors.py). */
interface Vector {
  name: string;
  op: 'reposition' | 'addTags' | 'removeTags' | 'deck';
  cids?: number[]; start?: number; step?: number; shift?: boolean;
  nids?: number[]; tags?: string[]; deckId?: number;
  cards: { id: number; deck: string; home: string | null; queue: number; due: number; odue: number }[];
  notes: { id: number; tags: string }[];
}
const VECTORS: Vector[] = JSON.parse(readFileSync(join(FIXTURES, 'bulk-vectors.json'), 'utf8'));

async function kept() {
  const dir = mkdtempSync(join(tmpdir(), 'bulk-'));
  copyFileSync(join(FIXTURES, 'collection.anki2'), join(dir, 'collection.anki2'));
  return nodeSyncDb(join(dir, 'collection.anki2'), { unicase: true });
}

async function state(db: Awaited<ReturnType<typeof nodeSyncDb>>) {
  const decks = new Map((await db.all<{ id: number; name: string }>('SELECT id, name FROM decks NOT INDEXED')).map((d) => [Number(d.id), deckName(d.name)]));
  const cards = (await db.all<any>('SELECT id, did, odid, queue, due, odue FROM cards ORDER BY id')).map((c) => ({
    id: Number(c.id), deck: decks.get(Number(c.did)), home: c.odid ? decks.get(Number(c.odid)) ?? null : null, queue: c.queue, due: c.due, odue: c.odue,
  }));
  const notes = (await db.all<any>('SELECT id, tags FROM notes ORDER BY id')).map((n) => ({ id: Number(n.id), tags: n.tags }));
  return { cards, notes };
}

describe("Browse's actions in the kept collection, as Anki writes them, and undone", () => {
  for (const v of VECTORS) {
    it(v.name, async () => {
      const db = await kept();
      const before = await state(db);
      let undo;
      if (v.op === 'reposition') {
        undo = (await repositionAnkiCards(db, v.cids!, { start: v.start!, step: v.step!, randomize: false, shift: v.shift! }, NOW)).undo;
      } else if (v.op === 'deck') {
        undo = await moveAnkiNotesUndoable(db, v.nids!, v.deckId!, NOW);
      } else {
        const tagsOf = new Map<number, string[]>();
        for (const n of before.notes.filter((x) => v.nids!.includes(x.id))) {
          const tags = n.tags.trim().split(/\s+/).filter(Boolean);
          tagsOf.set(n.id, v.op === 'addTags' ? withTagsAdded(tags, v.tags!) : withTagsRemoved(tags, v.tags!));
        }
        undo = await setAnkiNoteTags(db, tagsOf, NOW);
      }
      expect(await state(db)).toEqual({ cards: v.cards, notes: v.notes });
      // Undo puts every row back as it was.
      expect(await undoAnkiAction(db, undo, NOW)).toBe(true);
      expect(await state(db)).toEqual(before);
      db.close();
    });
  }
});
