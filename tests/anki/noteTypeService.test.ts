import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildExport } from '../../src/anki/collection';
import type { NoteStore } from '../../src/anki/noteService';
import { NoteTypeRefused, saveNoteTypeLook } from '../../src/anki/noteTypeService';
import { decodeMessage, string } from '../../src/anki/protobuf';
import { MemoryRepo } from '../../src/db/repo';
import { importAnkiJson } from '../../src/import/ankiJson';
import { readCollectionRows } from '../support/ankiRows';
import { nodeSyncDb } from '../support/syncDb';

const FIXTURE = join(__dirname, '..', 'fixtures', 'anki', 'collection.anki2');
const NOW = new Date(2026, 10, 11, 12);
const REVERSED = 'Basic (and reversed card)';

/** Franki as the app has it after importing the fixture: its tables, and the kept collection (with Anki's collation unless said). */
async function franki(opts: { kept?: boolean; unicase?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ntsvc-'));
  const kept = join(dir, 'collection.anki2');
  copyFileSync(FIXTURE, kept);
  const repo = new MemoryRepo();
  const data = importAnkiJson(buildExport(await readCollectionRows(kept)), { now: NOW });
  await repo.saveNoteTypes(data.noteTypes ?? []);
  await repo.applyAnkiCollection(data.notes, data.cards);
  const anki = () => nodeSyncDb(kept, { unicase: opts.unicase ?? true });
  const store = Object.assign(repo, {
    keptCollection: async () => (opts.kept === false ? null : {}),
    lockAnki: <T,>(fn: () => Promise<T>) => fn(),
    withSyncConnection: async <T,>(fn: (db: Awaited<ReturnType<typeof nodeSyncDb>>) => Promise<T>) => {
      const db = await anki();
      try { return await fn(db); } finally { db.close(); }
    },
  }) as NoteStore & MemoryRepo;
  return { store, anki };
}

async function ankiTemplates(anki: () => ReturnType<typeof nodeSyncDb>, name: string) {
  const db = await anki();
  const nt = (await db.all<{ id: number; name: string; config: Uint8Array; usn: number }>('SELECT id, name, config, usn FROM notetypes NOT INDEXED')).find((r) => r.name === name)!;
  const rows = await db.all<{ ord: number; config: Uint8Array }>('SELECT ord, config FROM templates WHERE ntid = ? ORDER BY ord', nt.id);
  db.close();
  return { usn: nt.usn, css: string(decodeMessage(nt.config), 3), fronts: rows.map((r) => string(decodeMessage(r.config), 1)) };
}

describe("saving a note type's templates and styling", () => {
  it('writes the kept collection and Franki\'s copy, leaving the card types it was not given as they were', async () => {
    const { store, anki } = await franki();
    const saved = await saveNoteTypeLook(store, REVERSED, { templates: [{ ord: 0, front: '<b>{{Front}}</b>', back: '{{FrontSide}}<hr id=answer>{{Back}}' }], css: '.card { color: navy; }' }, NOW);
    expect(saved.templates[0].front).toBe('<b>{{Front}}</b>');
    expect((await store.listNoteTypes()).get(REVERSED)).toEqual(saved);
    const inAnki = await ankiTemplates(anki, REVERSED);
    expect(inAnki).toMatchObject({ usn: -1, css: '.card { color: navy; }' });
    expect(inAnki.fronts).toEqual(['<b>{{Front}}</b>', saved.templates[1].front]);
  });

  it("refuses what Anki would refuse, saving nothing in either place", async () => {
    const { store, anki } = await franki();
    const before = (await store.listNoteTypes()).get(REVERSED);
    await expect(saveNoteTypeLook(store, REVERSED, { templates: [{ ord: 1, front: '{{Bak}}', back: '' }], css: '' }, NOW))
      .rejects.toThrow(new NoteTypeRefused("Card 2's front uses a field called Bak. This note type has no such field."));
    expect((await store.listNoteTypes()).get(REVERSED)).toEqual(before);
    expect((await ankiTemplates(anki, REVERSED)).usn).not.toBe(-1);
  });

  it('refuses a change that would give a note a card it does not have yet, as Anki would add one', async () => {
    const { store } = await franki();
    // A reversed note with an empty Back has no card 2; a front showing Front too would make one.
    await store.upsertNotesAndCards([{ id: 'n1', deck: 'Default', model: REVERSED, fields: { Front: 'a', Back: '' }, tags: [] }], [{ ...(await store.listCards())[0], id: 'n1:t0', noteId: 'n1', kind: 't0' }]);
    const nt = (await store.listNoteTypes()).get(REVERSED)!;
    await expect(saveNoteTypeLook(store, REVERSED, { templates: [{ ...nt.templates[1], front: '{{Back}}{{Front}}' }], css: nt.css }, NOW))
      .rejects.toThrow("This change would give 1 note a card it doesn't have yet.");
  });

  it('changes only Franki\'s copy when there is no Anki collection', async () => {
    const { store, anki } = await franki({ kept: false });
    await saveNoteTypeLook(store, 'Basic', { templates: [], css: 'x' }, NOW);
    expect((await store.listNoteTypes()).get('Basic')!.css).toBe('x');
    expect((await ankiTemplates(anki, 'Basic')).css).not.toBe('x');
  });

  it("refuses on a build without Anki's collation, and a note type Franki doesn't have", async () => {
    const { store } = await franki({ unicase: false });
    await expect(saveNoteTypeLook(store, 'Basic', { templates: [], css: 'x' }, NOW)).rejects.toThrow("This build of Franki can't change note types");
    expect((await store.listNoteTypes()).get('Basic')!.css).not.toBe('x');
    await expect(saveNoteTypeLook(store, 'Nope', { templates: [], css: '' }, NOW)).rejects.toBeInstanceOf(NoteTypeRefused);
  });
});
