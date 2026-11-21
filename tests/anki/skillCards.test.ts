import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildExport } from '../../src/anki/collection';
import type { NoteStore } from '../../src/anki/noteService';
import { addSkillCards, deleteSkillCards, missingDrafts, missingWordDrafts, setSkillsPaused, SkillsRefused } from '../../src/anki/skillCards';
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
    expect(got).toEqual({ deck: 'Thai::Skills', added: 4, words: 0, skipped: 0 });
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
    expect(again).toEqual({ deck: 'Thai::Skills', added: 4, words: 0, skipped: 4 });
  });

  it('refuses without a Basic note type, adding nothing', async () => {
    const { store } = await franki({ basic: false });
    const before = store.notes.size;
    await expect(addSkillCards(store, { ...add, groups: ['time'] })).rejects.toBeInstanceOf(SkillsRefused);
    expect(store.notes.size).toBe(before);
  });

  it('refuses Saying dates without the note type its words are written in, adding nothing', async () => {
    const { store } = await franki();
    const before = store.notes.size;
    const refused = addSkillCards(store, { ...add, groups: ['dates'] });
    await expect(refused).rejects.toBeInstanceOf(SkillsRefused);
    await expect(refused).rejects.toThrow(/Omnilanguage/);
    expect(store.notes.size).toBe(before);
  });

  it('refuses a language with no skill cards', async () => {
    const { store } = await franki();
    await expect(addSkillCards(store, { ...add, language: 'en', languageName: 'English', groups: ['time'] })).rejects.toBeInstanceOf(SkillsRefused);
  });
});

describe('the words a skill needs', () => {
  const note = (id: string, deck: string, Entry: string, tags: string[] = []) => ({ id, deck, model: 'Omnilanguage', fields: { Entry, Meaning: 'x' }, tags });

  it('are every month and weekday the deck lacks', () => {
    const all = missingWordDrafts([], 'Thai', 'th', ['dates']);
    expect(all).toHaveLength(19);
    expect(all.every((d) => d.tags.join() === 'skill::words' && d.fields.Language === 'thai' && d.fields.PartOfSpeech === 'noun' && d.fields.GenerateReverse === 'y')).toBe(true);
    expect(all[0].fields).toMatchObject({ Entry: 'มกราคม', Meaning: 'January' });
  });

  it('leave out one the deck has in any subdeck, studied or not, or inside a longer headword', () => {
    const notes = [note('1', 'Thai::Tier 1', 'มกราคม'), note('2', 'Norsk', 'januar'), note('3', 'Thai', 'วันจันทร์')];
    const left = missingWordDrafts(notes, 'Thai', 'th', ['dates']).map((d) => d.fields.Entry);
    expect(left).toHaveLength(17);
    expect(left).not.toContain('มกราคม');
    expect(left).not.toContain('วันจันทร์');
    expect(missingWordDrafts([note('4', 'Polski::Tier 1', 'luty, miesiąc')], 'Polski', 'pl', ['dates']).map((d) => d.fields.Entry)).not.toContain('luty');
  });

  it('are none for a skill that needs no words', () => {
    expect(missingWordDrafts([], 'Thai', 'th', ['time', 'numbers', 'money'])).toEqual([]);
  });

  it('are not counted as skill cards', () => {
    const skillWord = note('5', 'Thai::Skills', 'มกราคม', ['skill::words']);
    expect(missingDrafts([skillWord], 'th', 'Thai', ['dates'])).toHaveLength(3);
  });
});

describe('what adding would still write', () => {
  it('counts only the cards the deck lacks', async () => {
    const { store } = await franki();
    expect(missingDrafts(store.notes.values(), 'th', 'Thai', ['time', 'numbers'])).toHaveLength(8);
    await addSkillCards(store, { ...add, groups: ['time'] });
    expect(missingDrafts(store.notes.values(), 'th', 'Thai', ['time', 'numbers'])).toHaveLength(4);
  });
});

describe('pausing and resuming a deck\'s skill cards', () => {
  const skillCards = (store: MemoryRepo) => {
    const ids = new Set([...store.notes.values()].filter((n) => n.tags.includes('skill')).map((n) => n.id));
    return [...store.cards.values()].filter((c) => ids.has(c.noteId));
  };

  it('suspends every card that was live, and resuming frees all but a later step', async () => {
    const { store } = await franki();
    await addSkillCards(store, { ...add, groups: ['time', 'consonants'] });
    const total = skillCards(store).length;
    expect(await setSkillsPaused(store, 'Thai', true, NOW, 4)).toBe(total - 3);
    expect(skillCards(store).every((c) => c.suspended)).toBe(true);
    // Everything but the three later steps comes back: they wait on the step before.
    expect(await setSkillsPaused(store, 'Thai', false, NOW, 4)).toBe(total - 3);
    expect(skillCards(store).filter((c) => c.suspended)).toHaveLength(3);
  });

  it("leaves another deck's skill cards alone", async () => {
    const { store } = await franki();
    await addSkillCards(store, { ...add, groups: ['time'] });
    expect(await setSkillsPaused(store, 'Polski', true, NOW, 4)).toBe(0);
  });
});

describe('deleting a deck\'s skill cards', () => {
  it('removes the skill notes and nothing else', async () => {
    const { store } = await franki();
    const before = store.notes.size;
    await addSkillCards(store, { ...add, groups: ['time'] });
    expect(await deleteSkillCards(store, 'Thai', NOW)).toBe(4);
    expect(store.notes.size).toBe(before);
  });
});
