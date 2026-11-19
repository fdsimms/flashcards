import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildExport } from '../../src/anki/collection';
import type { NoteStore } from '../../src/anki/noteService';
import { addSkillCards, SkillsRefused } from '../../src/anki/skillCards';
import { MemoryRepo } from '../../src/db/repo';
import { importAnkiJson } from '../../src/import/ankiJson';
import { readCollectionRows } from '../support/ankiRows';
import { nodeSyncDb } from '../support/syncDb';

const FIXTURE = join(__dirname, '..', 'fixtures', 'anki', 'collection.anki2');
const NOW = new Date(2026, 10, 11, 12);

async function franki(opts: { basic?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'skills-'));
  const kept = join(dir, 'collection.anki2');
  copyFileSync(FIXTURE, kept);
  const repo = new MemoryRepo();
  const data = importAnkiJson(buildExport(await readCollectionRows(kept)), { now: NOW });
  await repo.saveNoteTypes((data.noteTypes ?? []).filter((t) => opts.basic !== false || t.name !== 'Basic'));
  await repo.applyAnkiCollection(data.notes, data.cards);
  const states: unknown[] = [];
  const store = Object.assign(repo, {
    keptCollection: async () => ({}),
    lockAnki: <T,>(fn: () => Promise<T>) => fn(),
    withSyncConnection: async <T,>(fn: (db: Awaited<ReturnType<typeof nodeSyncDb>>) => Promise<T>) => {
      const db = await nodeSyncDb(kept, { unicase: true });
      try { return await fn(db); } finally { db.close(); }
    },
    setAnkiCardStates: async (rows: unknown[]) => { states.push(...rows); },
  }) as unknown as NoteStore & MemoryRepo & { setAnkiCardStates: (rows: unknown[]) => Promise<void> };
  return { store, states, anki: () => nodeSyncDb(kept) };
}

const add = { deck: 'Thai', language: 'th' as const, languageName: 'Thai', dayStartsAtHour: 4, refresh: async () => {}, now: NOW };

describe('adding skill cards', () => {
  it('adds Basic notes in the deck\'s Skills subdeck, in Anki too, the later steps suspended', async () => {
    const { store, anki } = await franki();
    const got = await addSkillCards(store, { ...add, groups: ['time'] });
    expect(got).toEqual({ deck: 'Thai::Skills', added: 4, skipped: 0 });
    const notes = [...store.notes.values()].filter((n) => n.tags.includes('skill'));
    expect(notes).toHaveLength(4);
    expect(notes.every((n) => n.deck === 'Thai::Skills' && n.model === 'Basic' && /^\d+$/.test(n.id))).toBe(true);
    const cards = [...store.cards.values()].filter((c) => notes.some((n) => n.id === c.noteId));
    expect(cards.filter((c) => c.suspended)).toHaveLength(3);
    const db = await anki();
    const inAnki = await db.all<{ n: number }>("SELECT COUNT(*) AS n FROM notes WHERE tags LIKE '% skill %'");
    expect(inAnki[0].n).toBe(4);
    db.close();
  });

  it('skips what the deck already has when added again', async () => {
    const { store } = await franki();
    await addSkillCards(store, { ...add, groups: ['time'] });
    const again = await addSkillCards(store, { ...add, groups: ['time', 'numbers'] });
    expect(again).toEqual({ deck: 'Thai::Skills', added: 4, skipped: 4 });
  });

  it('refuses without a Basic note type, adding nothing', async () => {
    const { store } = await franki({ basic: false });
    const before = store.notes.size;
    await expect(addSkillCards(store, { ...add, groups: ['time'] })).rejects.toBeInstanceOf(SkillsRefused);
    expect(store.notes.size).toBe(before);
  });

  it('refuses a language with no skill cards', async () => {
    const { store } = await franki();
    await expect(addSkillCards(store, { ...add, language: 'en', languageName: 'English', groups: ['time'] })).rejects.toBeInstanceOf(SkillsRefused);
  });
});
