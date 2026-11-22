import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { deckPackagePreviewText, deckPackageResultLines, mergeDeckPackage, packageMediaPlan, planDeckPackage, type DeckPackagePlan } from '../../src/anki/apkgMerge';
import { readPackage } from '../../src/anki/package';
import { nodeSyncDb } from '../support/syncDb';
import { fileSource, memorySink, writeBytes } from '../support/bytes';
import { unicaseExtension } from '../support/unicase';

const DIR = join(__dirname, '..', 'fixtures', 'anki');
const FIXTURE = join(DIR, 'collection.anki2');
/** "🧠 Trivia" exported by Anki as a deck package, and what Anki's own import made of it (make-apkg.py). */
const APKG = join(DIR, 'deck.apkg');
const LEGACY = join(DIR, 'deck-legacy.apkg');
const VECTORS = JSON.parse(readFileSync(join(DIR, 'apkg-vectors.json'), 'utf8'));
const NOW = new Date(2026, 10, 21, 12);
const CTX = { now: NOW, dayStartsAtHour: 4 };

const opened: { close(): void }[] = [];
afterEach(() => { while (opened.length) opened.pop()!.close(); });

async function setup(unicase = true) {
  const dir = mkdtempSync(join(tmpdir(), 'apkg-'));
  const kept = join(dir, 'collection.anki2');
  copyFileSync(FIXTURE, kept);
  const sink = memorySink();
  const unpacked = await readPackage(fileSource(APKG), { collection: async () => sink, media: async () => memorySink() });
  const pkg = join(dir, 'package.anki2');
  writeBytes(pkg, sink.bytes());
  const db = await nodeSyncDb(kept, { unicase });
  opened.push(db);
  return { db, pkg, unpacked };
}

async function snapshot(db: Awaited<ReturnType<typeof setup>>['db']) {
  const rows = async (sql: string) => JSON.stringify(await db.all(sql));
  return [
    await rows('SELECT * FROM notes ORDER BY id'), await rows('SELECT * FROM cards ORDER BY id'), await rows('SELECT * FROM revlog ORDER BY id'),
    await rows('SELECT id, name FROM decks NOT INDEXED ORDER BY id'), await rows('SELECT id, name FROM notetypes NOT INDEXED ORDER BY id'),
  ];
}

describe('reading a deck package', () => {
  it('finds the current-format collection and its media', async () => {
    const { unpacked } = await setup();
    expect(unpacked.version).toBe(3);
    expect(unpacked.hasCollection).toBe(true);
    expect([...unpacked.mediaNames].sort()).toEqual(['flag.svg', 'hello.mp3', 'lima.jpg']);
    expect(unpacked.mediaSha1.every((s) => /^[0-9a-f]{40}$/.test(s ?? ''))).toBe(true);
  });

  it('sees no current-format collection in one exported for older Anki versions', async () => {
    const r = await readPackage(fileSource(LEGACY), { collection: async () => memorySink(), media: async () => memorySink() });
    expect(r.hasCollection).toBe(false);
    expect(r.version).toBeLessThan(3);
  });
});

describe.skipIf(!unicaseExtension())('merging a deck package into the collection', () => {
  it('previews what it would add without writing anything', async () => {
    const { db, pkg } = await setup();
    const before = await snapshot(db);
    const plan = await planDeckPackage(db, pkg, CTX);
    expect(plan).toEqual({
      newNotes: 3, alreadyHere: 4, cards: 3, reviews: 3,
      decks: ['🧠 Trivia', '🧠 Trivia::Geography'], newDecks: ['🧠 Trivia::Geography'], newNoteTypes: ['Vocab'],
    });
    expect(await snapshot(db)).toEqual(before);
  });

  it('adds what Anki\'s own import adds, with the same scheduling', async () => {
    const { db, pkg } = await setup();
    await mergeDeckPackage(db, pkg, CTX);
    expect((await db.first<{ c: number }>('SELECT COUNT(*) AS c FROM notes'))!.c).toBe(VECTORS.notes);
    expect((await db.first<{ c: number }>('SELECT COUNT(*) AS c FROM cards'))!.c).toBe(VECTORS.cards);
    expect((await db.first<{ c: number }>('SELECT COUNT(*) AS c FROM revlog'))!.c).toBe(VECTORS.revlog);
    const decks = (await db.all<{ name: string }>('SELECT name FROM decks NOT INDEXED')).map((d) => d.name.split('\x1f').join('::')).sort();
    expect(decks).toEqual(VECTORS.decks);
    expect((await db.all<{ name: string }>('SELECT name FROM notetypes NOT INDEXED')).map((t) => t.name).sort()).toEqual(VECTORS.noteTypes);
    const deckName = new Map((await db.all<{ id: number; name: string }>('SELECT id, name FROM decks NOT INDEXED')).map((d) => [Number(d.id), d.name.split('\x1f').join('::')]));
    for (const want of VECTORS.cards_of_new_notes) {
      const card = (await db.first<Record<string, number>>(
        'SELECT c.id, c.did, c.ord, c.type, c.queue, c.due, c.ivl, c.reps, c.lapses, c.left, c.usn FROM cards c JOIN notes n ON n.id = c.nid WHERE n.guid = ? AND c.ord = ?', want.guid, want.ord,
      ))!;
      expect({ deck: deckName.get(Number(card.did)), type: card.type, queue: card.queue, due: card.due, ivl: card.ivl, reps: card.reps, lapses: card.lapses, left: card.left })
        .toEqual({ deck: want.deck, type: want.type, queue: want.queue, due: want.due, ivl: want.ivl, reps: want.reps, lapses: want.lapses, left: want.left });
      expect(card.usn).toBe(-1);
      expect((await db.first<{ c: number }>('SELECT COUNT(*) AS c FROM revlog WHERE cid = ? AND usn = -1', card.id))!.c).toBe(want.revlog);
    }
    // The new note type comes with its fields and card template, so the cards can be rendered.
    const vocab = (await db.first<{ id: number }>("SELECT id FROM notetypes NOT INDEXED WHERE name = 'Vocab'"))!;
    expect((await db.all<{ name: string }>('SELECT name FROM fields WHERE ntid = ? ORDER BY ord', vocab.id)).map((f) => f.name)).toEqual(['Front', 'Back']);
    expect((await db.all('SELECT name FROM templates WHERE ntid = ?', vocab.id))).toHaveLength(1);
    expect((await db.first<{ mod: number }>('SELECT mod FROM col'))!.mod).toBe(NOW.getTime());
  });

  it('leaves the notes the collection already has exactly as they were', async () => {
    const { db, pkg } = await setup();
    const before = await db.all('SELECT * FROM notes ORDER BY id');
    const cardsBefore = await db.all('SELECT * FROM cards ORDER BY id');
    await mergeDeckPackage(db, pkg, CTX);
    const ids = new Set((before as { id: number }[]).map((n) => n.id));
    expect((await db.all<{ id: number }>('SELECT * FROM notes ORDER BY id')).filter((n) => ids.has(n.id))).toEqual(before);
    const cardIds = new Set((cardsBefore as { id: number }[]).map((c) => c.id));
    expect((await db.all<{ id: number }>('SELECT * FROM cards ORDER BY id')).filter((c) => cardIds.has(c.id))).toEqual(cardsBefore);
  });

  it('changes nothing when the same file is imported again', async () => {
    const { db, pkg } = await setup();
    await mergeDeckPackage(db, pkg, CTX);
    const once = await snapshot(db);
    const again = await mergeDeckPackage(db, pkg, { ...CTX, now: new Date(2026, 10, 22, 9) });
    expect(again).toMatchObject({ newNotes: 0, alreadyHere: 7, cards: 0, reviews: 0, newDecks: [], newNoteTypes: [] });
    expect(await snapshot(db)).toEqual(once);
  });

  it('sends a card a filtered deck borrowed home with its own due and the queue its type puts it in', async () => {
    const { db, pkg } = await setup();
    // A new card as a filtered deck built without rescheduling holds it: in the review queue, its position kept in odue.
    const edit = await nodeSyncDb(pkg, { unicase: true });
    opened.push(edit);
    const fresh = VECTORS.cards_of_new_notes.find((c: { type: number }) => c.type === 0);
    const card = (await edit.first<{ id: number; ord: number }>('SELECT c.id, c.ord FROM cards c JOIN notes n ON n.id = c.nid WHERE n.guid = ? AND c.ord = ?', fresh.guid, fresh.ord))!;
    await edit.run('UPDATE cards SET odid = did, odue = 7, due = 123, queue = 2 WHERE id = ?', card.id);
    const guid = fresh.guid;
    edit.close();
    opened.pop();
    await mergeDeckPackage(db, pkg, CTX);
    const merged = (await db.first<{ queue: number; due: number; odid: number; odue: number }>(
      'SELECT c.queue, c.due, c.odid, c.odue FROM cards c JOIN notes n ON n.id = c.nid WHERE n.guid = ? AND c.ord = ?', guid, card.ord,
    ))!;
    expect(merged).toEqual({ queue: 0, due: 7, odid: 0, odue: 0 });
  });

  it('gives a parent deck the package left out an id of its own', async () => {
    const { db, pkg } = await setup();
    const edit = await nodeSyncDb(pkg, { unicase: true });
    opened.push(edit);
    await edit.run("UPDATE decks SET name = 'Atlas' || char(31) || 'Geography' WHERE name = '🧠 Trivia' || char(31) || 'Geography'");
    edit.close();
    opened.pop();
    const plan = await mergeDeckPackage(db, pkg, CTX);
    expect(plan.newDecks).toContain('Atlas');
    const atlas = (await db.first<{ id: number }>("SELECT id FROM decks NOT INDEXED WHERE name = 'Atlas'"))!;
    expect(Number(atlas.id)).toBeGreaterThan(0);
  });

  it('adds a note type changed since under a name of its own, beside the one here', async () => {
    const { db, pkg } = await setup();
    // The collection's "Basic" gains a field, so the package's "Basic" (same id) no longer matches it.
    const basic = (await db.first<{ id: number }>("SELECT id FROM notetypes NOT INDEXED WHERE name = 'Basic'"))!;
    await db.run("INSERT INTO fields (ntid, ord, name, config) SELECT ntid, 2, 'Extra', config FROM fields WHERE ntid = ? AND ord = 1", basic.id);
    const plan = await mergeDeckPackage(db, pkg, CTX);
    expect(plan.newNoteTypes.sort()).toEqual(['Basic (imported)', 'Vocab']);
    const added = (await db.first<{ id: number }>("SELECT id FROM notetypes NOT INDEXED WHERE name = 'Basic (imported)'"))!;
    expect(Number(added.id)).not.toBe(Number(basic.id));
    expect((await db.first<{ c: number }>('SELECT COUNT(*) AS c FROM notes WHERE mid = ?', added.id))!.c).toBe(1);
  });
});

describe('merging without Anki\'s collation', () => {
  it('refuses a package that needs a deck or note type added, and writes nothing', async () => {
    const { db, pkg } = await setup(false);
    const before = await db.all('SELECT id FROM notes');
    await expect(mergeDeckPackage(db, pkg, CTX)).rejects.toThrow("can't add decks or note types");
    expect(await db.all('SELECT id FROM notes')).toEqual(before);
  });
});

describe('a deck package\'s media', () => {
  const files = [
    { index: 0, name: 'new.jpg', sha1: 'a'.repeat(40) },
    { index: 1, name: 'same.mp3', sha1: 'b'.repeat(40) },
    { index: 2, name: 'clash.svg', sha1: 'c'.repeat(40) },
    { index: 3, name: '../evil', sha1: 'd'.repeat(40) },
  ];
  const here = new Map([['same.mp3', 'b'.repeat(40)], ['clash.svg', 'f'.repeat(40)]]);

  it('adds what isn\'t here, skips what is, and keeps a different file of the same name', () => {
    const plan = packageMediaPlan(files, (name) => here.get(name));
    expect(plan.add.map((f) => f.name)).toEqual(['new.jpg']);
    expect(plan.kept).toEqual(['clash.svg']);
  });
});

describe('what the screen says about a deck package', () => {
  const plan: DeckPackagePlan = {
    newNotes: 3, alreadyHere: 4, cards: 3, reviews: 3,
    decks: ['🧠 Trivia', '🧠 Trivia::Geography'], newDecks: ['🧠 Trivia::Geography'], newNoteTypes: ['Vocab'],
  };

  it('previews what it adds', () => {
    // A new note type goes up in a normal sync (the merge needs the collation that allows it), so there's no full upload to warn of.
    expect(deckPackagePreviewText(plan, 1)).toBe(
      'Adds 3 new notes (3 cards, 3 past reviews) to 🧠 Trivia and 🧠 Trivia::Geography. 4 notes are already here and stay as they are.\n\n'
      + 'New deck: 🧠 Trivia::Geography. New note type: Vocab. Also adds 1 image or sound.',
    );
    expect(deckPackagePreviewText({ ...plan, newNoteTypes: [], newDecks: [] }, 0)).toBe(
      'Adds 3 new notes (3 cards, 3 past reviews) to 🧠 Trivia and 🧠 Trivia::Geography. 4 notes are already here and stay as they are.',
    );
  });

  it('reports what it added, a package with nothing new, and a media file it kept', () => {
    expect(deckPackageResultLines('Trivia.apkg', plan, 1, ['flag.svg'])).toEqual([
      "Imported Trivia.apkg: 3 notes, 3 cards, 3 past reviews, 1 image or sound. 4 notes were already here and weren't changed.",
      '1 image or sound in it has the same name as a different file here (e.g. flag.svg), so Franki kept its own.',
    ]);
    expect(deckPackageResultLines('Trivia.apkg', { ...plan, newNotes: 0, alreadyHere: 7 }, 0, [])).toEqual([
      'Trivia.apkg has nothing new: all 7 notes are already here. Nothing was changed.',
    ]);
  });
});
