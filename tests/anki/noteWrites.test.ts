import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { addAnkiNote, ankiDeckId, ankiNoteType, deleteAnkiNotes, editAnkiNote, newGuid } from '../../src/anki/noteWrites';
import { nodeSyncDb } from '../support/syncDb';
import { unicaseExtension } from '../support/unicase';

const FIXTURE = join(__dirname, '..', 'fixtures', 'anki', 'collection.anki2');
const NOW = new Date(2026, 10, 11, 12);
const opened: { close(): void }[] = [];
afterEach(() => { while (opened.length) opened.pop()!.close(); });

async function collection(unicase: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'notes-'));
  const path = join(dir, 'collection.anki2');
  copyFileSync(FIXTURE, path);
  const db = await nodeSyncDb(path, { unicase });
  opened.push(db);
  return db;
}

describe('a note\'s guid', () => {
  it('is a 64-bit number in Anki\'s base 91', () => {
    expect(newGuid(() => 0)).toBe('a');
    expect(newGuid(() => 0.999999999)).toMatch(/^[!-~]{9,10}$/);
  });
});

for (const unicase of [false, true]) {
  describe.skipIf(unicase && !unicaseExtension())(`notes written into the Anki collection, ${unicase ? 'with' : 'without'} Anki's collation`, () => {
    it('finds a note type with its fields in order, and a deck by its full name', async () => {
      const db = await collection(unicase);
      const nt = (await ankiNoteType(db, 'Basic (and reversed card)', ['Front', 'Back']))!;
      expect(nt.fieldNames).toEqual(['Front', 'Back']);
      expect(nt.id).toBeGreaterThan(0);
      expect(await ankiNoteType(db, 'No such type', [])).toBeNull();
      expect(await ankiDeckId(db, '👅 Languages::🐘 ภาษาไทย')).toBeGreaterThan(1);
      expect(await ankiDeckId(db, 'Nope')).toBeNull();
    });

    it('adds a note and its cards as Anki would, at the next new-card position', async () => {
      const db = await collection(unicase);
      const nt = (await ankiNoteType(db, 'Basic (and reversed card)', ['Front', 'Back']))!;
      const did = (await ankiDeckId(db, '🧠 Trivia'))!;
      const pos = Number(new TextDecoder().decode((await db.first<{ val: Uint8Array }>("SELECT val FROM config WHERE KEY = 'nextPos'"))!.val));
      const { nid, cards } = await addAnkiNote(db, {
        noteType: nt, deckId: did, fields: { Front: '<b>Capital</b> of Peru?', Back: 'Lima' }, tags: ['geo', 'Noun', 'GEO'], ords: [0, 1], now: NOW,
      });
      const note = await db.first<Record<string, unknown>>('SELECT * FROM notes WHERE id = ?', nid);
      expect(note).toMatchObject({ mid: nt.id, usn: -1, flds: '<b>Capital</b> of Peru?\x1fLima', sfld: 'Capital of Peru?', flags: 0, data: '' });
      expect(String(note!.tags)).toMatch(unicase ? /^ geo noun $/ : /^ geo Noun $/); // the collection already has "noun"
      expect(String(note!.guid)).toMatch(/^[!-~]{1,10}$/);
      expect(nid).toBeGreaterThanOrEqual(NOW.getTime());
      expect(await db.all('SELECT ord, did, type, queue, due, usn, data FROM cards WHERE nid = ? ORDER BY ord', nid)).toEqual([
        { ord: 0, did, type: 0, queue: 0, due: pos, usn: -1, data: '{}' },
        { ord: 1, did, type: 0, queue: 0, due: pos, usn: -1, data: '{}' },
      ]);
      expect(cards.map((c) => c.ord)).toEqual([0, 1]);
      expect(new TextDecoder().decode((await db.first<{ val: Uint8Array }>("SELECT val FROM config WHERE KEY = 'nextPos'"))!.val)).toBe(String(pos + 1));
      expect((await db.first<{ mod: number }>('SELECT mod FROM col'))!.mod).toBe(NOW.getTime());
      if (unicase) expect(await db.first('SELECT tag, usn FROM tags WHERE tag = ?', 'geo')).toEqual({ tag: 'geo', usn: -1 });
    });

    it('edits fields and tags, and adds a card the note now generates, in its deck', async () => {
      const db = await collection(unicase);
      const nt = (await ankiNoteType(db, 'Basic (and reversed card)', ['Front', 'Back']))!;
      const did = (await ankiDeckId(db, '🧠 Trivia'))!;
      const { nid } = await addAnkiNote(db, { noteType: nt, deckId: did, fields: { Front: 'Capital of Chile?', Back: '' }, tags: [], ords: [0], now: NOW });
      const added = await editAnkiNote(db, { nid, noteType: nt, fields: { Front: 'Capital of Chile?', Back: 'Santiago' }, tags: ['geo'], ords: [0, 1], now: NOW });
      expect(added.map((c) => c.ord)).toEqual([1]);
      expect(await db.first('SELECT flds, tags, usn FROM notes WHERE id = ?', nid)).toEqual({ flds: 'Capital of Chile?\x1fSantiago', tags: ' geo ', usn: -1 });
      expect(await db.first('SELECT did, usn FROM cards WHERE id = ?', added[0].id)).toEqual({ did, usn: -1 });
    });

    it('leaves a note alone when nothing about it changed', async () => {
      const db = await collection(unicase);
      const nt = (await ankiNoteType(db, 'Basic', ['Front', 'Back']))!;
      const before = (await db.first<{ id: number; mod: number; usn: number }>("SELECT id, mod, usn FROM notes WHERE flds LIKE 'Capital of Bolivia?%'"))!;
      const colMod = (await db.first<{ mod: number }>('SELECT mod FROM col'))!.mod;
      await editAnkiNote(db, { nid: before.id, noteType: nt, fields: { Front: 'Capital of Bolivia?', Back: 'Sucre' }, tags: [], ords: [0], now: NOW });
      expect(await db.first('SELECT id, mod, usn FROM notes WHERE id = ?', before.id)).toEqual(before);
      expect((await db.first<{ mod: number }>('SELECT mod FROM col'))!.mod).toBe(colMod);
    });

    it('deletes a note with its cards, leaving graves for sync', async () => {
      const db = await collection(unicase);
      const nid = (await db.first<{ id: number }>("SELECT id FROM notes WHERE flds LIKE 'Capital of Peru?%'"))!.id;
      const cids = (await db.all<{ id: number }>('SELECT id FROM cards WHERE nid = ?', nid)).map((c) => c.id);
      await deleteAnkiNotes(db, [nid], NOW);
      expect(await db.first('SELECT id FROM notes WHERE id = ?', nid)).toBeNull();
      expect(await db.all('SELECT id FROM cards WHERE nid = ?', nid)).toEqual([]);
      expect(await db.all('SELECT oid, type, usn FROM graves ORDER BY type, oid')).toEqual([
        ...cids.map((oid) => ({ oid, type: 0, usn: -1 })), { oid: nid, type: 1, usn: -1 },
      ]);
    });
  });
}
