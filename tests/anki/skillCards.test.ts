import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildExport } from '../../src/anki/collection';
import { saveNote, type NoteStore } from '../../src/anki/noteService';
import { addSkillCards, deleteSkillCards, missingDrafts, missingWordDrafts, setSkillsPaused, setStepStopped, SkillsRefused } from '../../src/anki/skillCards';
import type { NoteType } from '../../src/core/types';
import { omnilanguageFieldNames } from '../../src/import/models';
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
  it('adds Basic notes in the deck\'s Skills subdeck, in Anki too, every step suspended until it can start', async () => {
    const { store, anki } = await franki();
    const got = await addSkillCards(store, { ...add, groups: ['time'] });
    // The collection has no Omnilanguage note type, so the words telling the time needs (one to ten, half, o'clock, the times of day...) are reported, not added.
    expect(got).toEqual({ deck: 'Thai::Skills', added: 4, words: 0, wordsSkipped: 22, skipped: 0 });
    const notes = [...store.notes.values()].filter((n) => n.tags.includes('skill'));
    expect(notes).toHaveLength(4);
    expect(notes.every((n) => n.deck === 'Thai::Skills' && n.model === 'Basic' && /^\d+$/.test(n.id))).toBe(true);
    const cards = [...store.cards.values()].filter((c) => notes.some((n) => n.id === c.noteId));
    // All four wait: the first for its word, the rest for the step before.
    expect(cards.filter((c) => c.suspended)).toHaveLength(4);
    const db = await anki();
    const inAnki = await db.all<{ n: number }>("SELECT COUNT(*) AS n FROM notes WHERE tags LIKE '% skill %'");
    expect(inAnki[0].n).toBe(4);
    db.close();
  });

  it('skips what the deck already has when added again', async () => {
    const { store } = await franki();
    await addSkillCards(store, { ...add, groups: ['time'] });
    const again = await addSkillCards(store, { ...add, groups: ['time', 'numbers'] });
    expect(again).toMatchObject({ deck: 'Thai::Skills', added: 4, words: 0, skipped: 4 });
  });

  it('refuses without a Basic note type, adding nothing', async () => {
    const { store } = await franki({ basic: false });
    const before = store.notes.size;
    await expect(addSkillCards(store, { ...add, groups: ['time'] })).rejects.toBeInstanceOf(SkillsRefused);
    expect(store.notes.size).toBe(before);
  });

  it('adds the cards and reports the words it could not add, without the note type they are written in', async () => {
    const { store } = await franki();
    const before = store.notes.size;
    const got = await addSkillCards(store, { ...add, groups: ['dates'] });
    expect(got).toMatchObject({ added: 3, words: 0, wordsSkipped: 34 });
    expect(store.notes.size).toBe(before + 3);
  });

  it('refuses a language with no skill cards', async () => {
    const { store } = await franki();
    await expect(addSkillCards(store, { ...add, language: 'en', languageName: 'English', groups: ['time'] })).rejects.toBeInstanceOf(SkillsRefused);
  });
});

describe('writing the words a skill needs', () => {
  const noteType = (name: string, fields: string[]): NoteType => ({ name, kind: 'normal', fields, css: '', templates: [{ ord: 0, name: 'Card 1', front: `{{${fields[0]}}}`, back: `{{${fields[1]}}}` }] });

  // No kept Anki collection: notes live in Franki's tables only, which is all the word-writing itself needs.
  async function offline() {
    const repo = new MemoryRepo();
    await repo.saveNoteTypes([noteType('Basic', ['Front', 'Back']), noteType('Omnilanguage', omnilanguageFieldNames)]);
    return Object.assign(repo, {
      keptCollection: async () => null,
      lockAnki: <T,>(fn: () => Promise<T>) => fn(),
      withSyncConnection: async () => { throw new Error('there is no kept collection'); },
      setAnkiCardStates: async () => {},
    }) as unknown as NoteStore & MemoryRepo & { setAnkiCardStates: (rows: unknown[]) => Promise<void> };
  }

  it('adds each missing word as an Omnilanguage note in the Skills subdeck, tagged, with its cards live', async () => {
    const store = await offline();
    const got = await addSkillCards(store, { ...add, groups: ['dates'] });
    expect(got).toEqual({ deck: 'Thai::Skills', added: 3, words: 34, wordsSkipped: 0, skipped: 0 });
    const words = [...store.notes.values()].filter((n) => n.model === 'Omnilanguage');
    expect(words).toHaveLength(34);
    expect(words.every((n) => n.deck === 'Thai::Skills' && n.tags.join() === 'skill::words' && n.fields.Language === 'thai')).toBe(true);
    expect(words.find((n) => n.fields.Entry === 'กุมภาพันธ์')?.fields).toMatchObject({ Meaning: 'February', PartOfSpeech: 'noun' });
    // Every field of the note type is there, empty where the word has nothing to say.
    expect(Object.keys(words[0].fields)).toEqual(expect.arrayContaining(omnilanguageFieldNames));
    const ids = new Set(words.map((n) => n.id));
    expect([...store.cards.values()].filter((c) => ids.has(c.noteId) && c.suspended)).toEqual([]);
  });

  it('leaves a word the deck has already, in any subdeck, and adds nothing the second time', async () => {
    const store = await offline();
    await saveNote(store, { deck: 'Thai::Tier 1', model: 'Omnilanguage', fields: { Entry: 'มกราคม', Meaning: 'January', Language: 'thai' }, tags: [] }, NOW);
    expect(await addSkillCards(store, { ...add, groups: ['dates'] })).toMatchObject({ words: 33 });
    expect([...store.notes.values()].filter((n) => n.fields.Entry === 'มกราคม')).toHaveLength(1);
    expect(await addSkillCards(store, { ...add, groups: ['dates'] })).toMatchObject({ added: 0, words: 0, wordsSkipped: 0 });
  });

  it('counts a word in a studied-or-not note of another language as not there', async () => {
    const store = await offline();
    await saveNote(store, { deck: 'Deutsch', model: 'Omnilanguage', fields: { Entry: 'Januar', Meaning: 'January', Language: 'german' }, tags: [] }, NOW);
    expect(await addSkillCards(store, { ...add, deck: 'Norsk', language: 'nb', languageName: 'Norwegian', groups: ['dates'] })).toMatchObject({ words: 70 });
  });
});

describe('the words a skill needs', () => {
  const note = (id: string, deck: string, Entry: string, tags: string[] = []) => ({ id, deck, model: 'Omnilanguage', fields: { Entry, Meaning: 'x' }, tags });

  it('are every month and weekday the deck lacks', () => {
    const all = missingWordDrafts([], 'Thai', 'th', ['dates']);
    expect(all).toHaveLength(34);
    expect(all.every((d) => d.tags.join() === 'skill::words' && d.fields.Language === 'thai' && d.fields.GenerateReverse === 'y')).toBe(true);
    expect(all[0].fields).toMatchObject({ Entry: 'มกราคม', Meaning: 'January' });
  });

  it('leave out one the deck has in any subdeck, studied or not, or inside a longer headword', () => {
    const notes = [note('1', 'Thai::Tier 1', 'มกราคม'), note('2', 'Norsk', 'januar'), note('3', 'Thai', 'วันจันทร์')];
    const left = missingWordDrafts(notes, 'Thai', 'th', ['dates']).map((d) => d.fields.Entry);
    expect(left).toHaveLength(32);
    expect(left).not.toContain('มกราคม');
    expect(left).not.toContain('วันจันทร์');
    expect(missingWordDrafts([note('4', 'Polski::Tier 1', 'luty, miesiąc')], 'Polski', 'pl', ['dates']).map((d) => d.fields.Entry)).not.toContain('luty');
  });

  it('are none for a skill that needs no words, and the number words, half, hundred, thousand and currency for the others', () => {
    expect(missingWordDrafts([], 'Thai', 'th', ['consonants', 'vowels', 'classifiers'])).toEqual([]);
    expect(missingWordDrafts([], 'Thai', 'th', ['time', 'numbers', 'money']).map((d) => d.fields.Entry)).toEqual([...'หนึ่ง สอง สาม สี่ ห้า หก เจ็ด แปด เก้า สิบ ครึ่ง โมง ยี่ เอ็ด เที่ยง คืน ตี เช้า บ่าย เย็น ทุ่ม นาที ร้อย พัน หมื่น แสน บาท'.split(' ')]);
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

  it('suspends every card that was live, and resuming frees all but a step that waits', async () => {
    const { store } = await franki();
    await addSkillCards(store, { ...add, groups: ['time', 'consonants'] });
    const total = skillCards(store).length;
    expect(await setSkillsPaused(store, 'Thai', true, NOW, 4)).toBe(total - 4);
    expect(skillCards(store).every((c) => c.suspended)).toBe(true);
    // Everything but the four time steps comes back: the first waits for its word, the rest for the step before.
    expect(await setSkillsPaused(store, 'Thai', false, NOW, 4)).toBe(total - 4);
    expect(skillCards(store).filter((c) => c.suspended)).toHaveLength(4);
  });

  it('leaves a step that was stopped suspended through a resume', async () => {
    const { store } = await franki();
    await addSkillCards(store, { ...add, groups: ['consonants'] });
    const live = skillCards(store).find((c) => !c.suspended)!;
    await setStepStopped(store, live.noteId, true, false, NOW, 4);
    await setSkillsPaused(store, 'Thai', true, NOW, 4);
    await setSkillsPaused(store, 'Thai', false, NOW, 4);
    expect(store.cards.get(live.id)!.suspended).toBe(true);
  });

  it("leaves another deck's skill cards alone", async () => {
    const { store } = await franki();
    await addSkillCards(store, { ...add, groups: ['time'] });
    expect(await setSkillsPaused(store, 'Polski', true, NOW, 4)).toBe(0);
  });
});

describe('stopping a step and starting it again', () => {
  it('tags the note and suspends its card, and Start again undoes both', async () => {
    const { store } = await franki();
    await addSkillCards(store, { ...add, groups: ['consonants'] });
    const card = [...store.cards.values()].find((c) => !c.suspended && store.notes.get(c.noteId)!.tags.includes('skill'))!;
    const stopped = await setStepStopped(store, card.noteId, true, false, NOW, 4);
    expect(stopped.tags).toContain('skill::stopped');
    expect(store.cards.get(card.id)!.suspended).toBe(true);
    const back = await setStepStopped(store, card.noteId, false, false, NOW, 4);
    expect(back.tags).not.toContain('skill::stopped');
    expect(store.cards.get(card.id)!.suspended).toBe(false);
  });

  it('takes off a covered tag too, but leaves the card suspended while the deck is paused', async () => {
    const { store } = await franki();
    await addSkillCards(store, { ...add, groups: ['consonants'] });
    const card = [...store.cards.values()].find((c) => !c.suspended && store.notes.get(c.noteId)!.tags.includes('skill'))!;
    const n = store.notes.get(card.noteId)!;
    await saveNote(store, { id: n.id, deck: n.deck, model: n.model, fields: n.fields, tags: [...n.tags, 'skill::covered'] }, NOW);
    await setStepStopped(store, card.noteId, true, false, NOW, 4);
    const back = await setStepStopped(store, card.noteId, false, true, NOW, 4);
    expect(back.tags.filter((t) => t.startsWith('skill::') && t !== 'skill::consonants' && !t.startsWith('skill::lang'))).toEqual([]);
    expect(store.cards.get(card.id)!.suspended).toBe(true);
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
