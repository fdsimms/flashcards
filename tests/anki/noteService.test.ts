import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildExport } from '../../src/anki/collection';
import { collapsedDecks, deleteNote, NoteRefused, saveLeechHint, saveNote, setCardStates, setDeckCollapsed, type NoteStore } from '../../src/anki/noteService';
import { review } from '../../src/core/scheduler';
import { MemoryRepo } from '../../src/db/repo';
import { importAnkiJson } from '../../src/import/ankiJson';
import { readCollectionRows } from '../support/ankiRows';
import { nodeSyncDb } from '../support/syncDb';

const FIXTURE = join(__dirname, '..', 'fixtures', 'anki', 'collection.anki2');
const NOW = new Date(2026, 10, 11, 12);

/** Franki as the app has it after importing the fixture: its tables, and the kept collection. */
async function franki(opts: { kept?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'notesvc-'));
  const kept = join(dir, 'collection.anki2');
  copyFileSync(FIXTURE, kept);
  const repo = new MemoryRepo();
  const data = importAnkiJson(buildExport(await readCollectionRows(kept)), { now: NOW });
  await repo.saveNoteTypes(data.noteTypes ?? []);
  await repo.applyAnkiCollection(data.notes, data.cards);
  const store = Object.assign(repo, {
    keptCollection: async () => (opts.kept === false ? null : {}),
    lockAnki: <T,>(fn: () => Promise<T>) => fn(),
    withSyncConnection: async <T,>(fn: (db: Awaited<ReturnType<typeof nodeSyncDb>>) => Promise<T>) => {
      const db = await nodeSyncDb(kept);
      try { return await fn(db); } finally { db.close(); }
    },
  }) as NoteStore & MemoryRepo;
  const anki = () => nodeSyncDb(kept);
  return { store, anki };
}

describe('saving a note', () => {
  it('adds a note to an Anki deck in both places, its cards linked to Anki\'s', async () => {
    const { store, anki } = await franki();
    const note = await saveNote(store, { deck: '🧠 Trivia', model: 'Basic (and reversed card)', fields: { Front: 'Capital of Uruguay?', Back: 'Montevideo' }, tags: ['geo'] }, NOW);
    expect(note.id).toMatch(/^\d+$/);
    const cards = [...store.cards.values()].filter((c) => c.noteId === note.id);
    expect(cards.map((c) => c.kind).sort()).toEqual(['t0', 't1']);
    const db = await anki();
    const ankiCards = await db.all<{ id: number; ord: number }>('SELECT id, ord FROM cards WHERE nid = ? ORDER BY ord', Number(note.id));
    expect(cards.map((c) => [c.kind, Number(c.ankiId)]).sort()).toEqual(ankiCards.map((c) => [`t${c.ord}`, c.id]));
    db.close();
  });

  it('edits a note, keeping each card\'s schedule and Anki link, and adding a card it now generates', async () => {
    const { store, anki } = await franki();
    const n = await saveNote(store, { deck: '🧠 Trivia', model: 'Basic (and reversed card)', fields: { Front: 'Capital of Paraguay?', Back: '' }, tags: [] }, NOW);
    const first = [...store.cards.values()].find((c) => c.noteId === n.id)!;
    const studied = { ...first, sched: review(first.sched, 3, NOW).sched };
    await store.saveCard(studied);
    await saveNote(store, { id: n.id, deck: n.deck, model: n.model, fields: { Front: 'Capital of Paraguay?', Back: 'Asunción' }, tags: ['geo'] }, NOW);
    const cards = [...store.cards.values()].filter((c) => c.noteId === n.id).sort((a, b) => a.kind.localeCompare(b.kind));
    expect(cards.map((c) => c.kind)).toEqual(['t0', 't1']);
    expect(cards[0]).toMatchObject({ ankiId: first.ankiId, sched: studied.sched });
    expect(cards[1].ankiId).toMatch(/^\d+$/);
    expect((await store.getNote(n.id))!.fields.Back).toBe('Asunción');
    const db = await anki();
    expect(await db.first('SELECT flds, tags FROM notes WHERE id = ?', Number(n.id))).toEqual({ flds: 'Capital of Paraguay?\x1fAsunción', tags: ' geo ' });
    db.close();
  });

  it('refuses a note that makes no cards, saying what to fill in', async () => {
    const { store } = await franki();
    await expect(saveNote(store, { deck: '🧠 Trivia', model: 'Basic', fields: { Front: '', Back: 'x' }, tags: [] }, NOW)).rejects.toBeInstanceOf(NoteRefused);
  });

  it('keeps a note in a deck Anki doesn\'t have, or with no Anki collection, in Franki only', async () => {
    const { store, anki } = await franki();
    const n = await saveNote(store, { deck: 'Franki only', model: 'Basic', fields: { Front: 'a', Back: 'b' }, tags: [] }, NOW);
    expect(n.id).toMatch(/^franki:/);
    expect([...store.cards.values()].filter((c) => c.noteId === n.id).every((c) => !c.ankiId)).toBe(true);
    const db = await anki();
    expect((await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM notes WHERE flds = 'a\x1fb'"))!.n).toBe(0);
    db.close();
    const alone = await franki({ kept: false });
    expect((await saveNote(alone.store, { deck: '🧠 Trivia', model: 'Basic', fields: { Front: 'a', Back: 'b' }, tags: [] }, NOW)).id).toMatch(/^franki:/);
  });
});

describe('a note kept under an id that isn\'t Anki\'s (matched to a TSV note on import)', () => {
  /** The fixture's note as `reconcileIds` leaves it when a TSV note was there first: Franki's id, Anki's cards. */
  async function rekeyed() {
    const f = await franki();
    const n = [...f.store.notes.values()].find((x) => x.fields.Front === 'Capital of Bolivia?')!;
    const id = `tsv:${n.deck}:Capital of Bolivia?`;
    const cards = [...f.store.cards.values()].filter((c) => c.noteId === n.id).map((c) => ({ ...c, id: `${id}:${c.kind}`, noteId: id }));
    await f.store.deleteNote(n.id);
    await f.store.upsertNotesAndCards([{ ...n, id }], cards);
    return { ...f, id, nid: Number(n.id) };
  }

  it('edits the Anki note its cards belong to', async () => {
    const { store, anki, id, nid } = await rekeyed();
    const n = (await store.getNote(id))!;
    await saveNote(store, { id, deck: n.deck, model: n.model, fields: { ...n.fields, Back: 'Sucre (and La Paz)' }, tags: n.tags }, NOW);
    const db = await anki();
    expect(String((await db.first<{ flds: string }>('SELECT flds FROM notes WHERE id = ?', nid))!.flds)).toContain('Sucre (and La Paz)');
    db.close();
  });

  it('deletes the Anki note its cards belong to', async () => {
    const { store, anki, id, nid } = await rekeyed();
    await deleteNote(store, id, NOW);
    const db = await anki();
    expect(await db.first('SELECT id FROM notes WHERE id = ?', nid)).toBeNull();
    db.close();
  });
});

describe('deleting a note', () => {
  it('removes it from Franki and the Anki collection, cards and all', async () => {
    const { store, anki } = await franki();
    const victim = [...store.notes.values()].find((n) => n.fields.Front === 'Capital of Bolivia?')!;
    await deleteNote(store, victim.id, NOW);
    expect(await store.getNote(victim.id)).toBeUndefined();
    expect([...store.cards.values()].some((c) => c.noteId === victim.id)).toBe(false);
    const db = await anki();
    expect(await db.first('SELECT id FROM notes WHERE id = ?', Number(victim.id))).toBeNull();
    expect((await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM graves WHERE oid = ? AND type = 1', Number(victim.id)))!.n).toBe(1);
    db.close();
  });
});

describe('moving a note to another deck', () => {
  it('moves its cards in Anki and the note in Franki, keeping their schedules', async () => {
    const { store, anki } = await franki();
    const note = [...store.notes.values()].find((n) => n.fields.Front === 'Capital of Peru?')!;
    const before = [...store.cards.values()].filter((c) => c.noteId === note.id);
    const target = '👅 Languages::🐘 ภาษาไทย';
    await saveNote(store, { id: note.id, deck: target, model: note.model, fields: note.fields, tags: note.tags }, NOW);
    expect((await store.getNote(note.id))!.deck).toBe(target);
    // A card in a filtered deck (the fixture has one) is taken out of it, as Anki's Change Deck does.
    expect(before.some((c) => c.filteredDeck)).toBe(true);
    expect([...store.cards.values()].filter((c) => c.noteId === note.id))
      .toEqual(before.map((c) => ({ ...c, filteredDeck: undefined, filteredDue: undefined })));
    const db = await anki();
    const homes = await db.all<{ did: number; odid: number }>('SELECT did, odid FROM cards WHERE nid = ?', Number(note.id));
    const decks = await db.all<{ id: number; name: string }>('SELECT id, name FROM decks NOT INDEXED');
    for (const { did, odid } of homes) {
      expect(odid).toBe(0);
      expect(decks.find((d) => d.id === did)!.name).toBe(target.split('::').join('\x1f'));
    }
    expect(await db.all('SELECT DISTINCT usn FROM cards WHERE nid = ?', Number(note.id))).toEqual([{ usn: -1 }]);
    db.close();
  });

  it("moves a card that had a deck of its own along with the note, as Anki's move does", async () => {
    const { store } = await franki();
    const note = [...store.notes.values()].find((n) => n.fields.Front === 'Capital of Bolivia?')!;
    const [card] = [...store.cards.values()].filter((c) => c.noteId === note.id);
    store.cards.set(card.id, { ...card, deck: '🧠 Trivia::Elsewhere' });
    await saveNote(store, { id: note.id, deck: 'Default', model: note.model, fields: note.fields, tags: note.tags }, NOW);
    expect(store.cards.get(card.id)!.deck).toBeUndefined();
  });

  it('refuses a deck the Anki collection doesn\'t have, changing nothing', async () => {
    const { store } = await franki();
    const note = [...store.notes.values()].find((n) => n.fields.Front === 'Capital of Peru?')!;
    await expect(saveNote(store, { id: note.id, deck: 'Not in Anki', model: note.model, fields: note.fields, tags: note.tags }, NOW))
      .rejects.toThrow(/no deck called "Not in Anki"/);
    expect((await store.getNote(note.id))!.deck).toBe(note.deck);
  });
});

describe('suspending, burying and flagging a card', () => {
  it('saves in Franki first, then sends the Anki cards to the kept collection', async () => {
    const repo = new MemoryRepo();
    const sent: unknown[] = [];
    const store = Object.assign(repo, { setAnkiCardStates: async (changes: unknown[]) => { sent.push(...changes); } });
    const data = importAnkiJson(buildExport(await readCollectionRows(FIXTURE)), { now: NOW });
    await repo.applyAnkiCollection(data.notes, data.cards);
    const card = data.cards.find((c) => !c.suspended)!;
    const { cards, ankiError } = await setCardStates(store, [card], (s) => ({ ...s, flag: 4, buried: true }), NOW, 4);
    expect(ankiError).toBeUndefined();
    expect(cards[0]).toMatchObject({ flag: 4, buriedAt: NOW.toISOString() });
    expect((await repo.listCards()).find((c) => c.id === card.id)).toMatchObject({ flag: 4 });
    expect(sent).toEqual([{ ankiId: card.ankiId, state: { suspended: false, buried: true, flag: 4 } }]);
  });

  it("keeps the change in Franki and reports it when Anki's collection can't take it", async () => {
    const repo = new MemoryRepo();
    const store = Object.assign(repo, { setAnkiCardStates: async () => { throw new Error('locked'); } });
    const data = importAnkiJson(buildExport(await readCollectionRows(FIXTURE)), { now: NOW });
    await repo.applyAnkiCollection(data.notes, data.cards);
    const card = data.cards.find((c) => !c.suspended)!;
    const { ankiError } = await setCardStates(store, [card], (s) => ({ ...s, suspended: true }), NOW, 4);
    expect((ankiError as Error).message).toBe('locked');
    expect((await repo.listCards()).find((c) => c.id === card.id)!.suspended).toBe(true);
  });
});

describe("saving a leech's hint", () => {
  /**
   * An Omnilanguage note with its forward card suspended, as a preset that suspends leeches leaves
   * it. The fixture has no Omnilanguage note type, so the note is Franki's; its card stands in for
   * an Anki one by its ankiId, which is what decides whether the kept collection is sent the change.
   */
  async function leech() {
    const { store } = await franki({ kept: false });
    const sent: unknown[] = [];
    const s = Object.assign(store, { setAnkiCardStates: async (changes: unknown[]) => { sent.push(...changes); } });
    const note = await saveNote(s, { deck: '🧠 Trivia', model: 'Omnilanguage', fields: { Entry: 'kot', Meaning: 'cat', Mnemonic: '' }, tags: ['leech'] }, NOW);
    const card = { ...[...s.cards.values()].find((c) => c.noteId === note.id)!, suspended: true, ankiId: '42' };
    await s.saveCard(card);
    return { store: s, sent, note, card };
  }

  it('saves the hint and unsuspends the card the answer suspended, in Franki and for the kept collection', async () => {
    const { store, sent, note, card } = await leech();
    const r = await saveLeechHint(store, note, 'a cat on a cot', card, NOW, 4);
    expect(r.note.fields.Mnemonic).toBe('a cat on a cot');
    expect(r.card).toMatchObject({ id: card.id, suspended: false });
    expect((await store.listCards()).find((c) => c.id === card.id)!.suspended).toBe(false);
    expect(sent).toEqual([{ ankiId: '42', state: { suspended: false, buried: false, flag: 0 } }]);
  });

  it('only saves the hint when the card was not suspended', async () => {
    const { store, sent, note, card } = await leech();
    const r = await saveLeechHint(store, note, 'a cat on a cot', undefined, NOW, 4);
    expect(r.card).toBeUndefined();
    expect((await store.getNote(note.id))!.fields.Mnemonic).toBe('a cat on a cot');
    expect((await store.listCards()).find((c) => c.id === card.id)!.suspended).toBe(true);
    expect(sent).toEqual([]);
  });

  it("keeps the hint and reports the card when it can't be unsuspended", async () => {
    const { store, note, card } = await leech();
    const failing = Object.assign(Object.create(store), { saveCard: async () => { throw new Error('disk full'); } }) as typeof store;
    const r = await saveLeechHint(failing, note, 'a cat on a cot', card, NOW, 4);
    expect((r.cardError as Error).message).toBe('disk full');
    expect((await store.getNote(note.id))!.fields.Mnemonic).toBe('a cat on a cot');
  });
});

describe('collapsing a deck on the deck list', () => {
  it("writes Anki's flag for a deck Anki has, and Franki's own for one it doesn't", async () => {
    const { store, anki } = await franki();
    // Every deck Anki makes starts collapsed.
    expect((await collapsedDecks(store)).has('👅 Languages')).toBe(true);
    await setDeckCollapsed(store, '👅 Languages', false, NOW);
    await setDeckCollapsed(store, 'TSV only', true, NOW);
    const now = await collapsedDecks(store);
    expect([now.has('👅 Languages'), now.has('TSV only'), now.has('🧠 Trivia')]).toEqual([false, true, true]);
    expect((await store.listDeckSettings()).get('👅 Languages')?.collapsed).toBeUndefined();
    const db = await anki();
    expect((await db.first<{ usn: number }>("SELECT usn FROM decks NOT INDEXED WHERE id = 1794408857989"))!.usn).toBe(-1);
    db.close();
    await setDeckCollapsed(store, 'TSV only', false, NOW);
    expect((await collapsedDecks(store)).has('TSV only')).toBe(false);
  });

  it("keeps it in Franki when there's no Anki collection", async () => {
    const { store } = await franki({ kept: false });
    await setDeckCollapsed(store, '👅 Languages', true, NOW);
    expect(await collapsedDecks(store)).toEqual(new Set(['👅 Languages']));
  });
});
