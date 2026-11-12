import { describe, expect, it } from 'vitest';
import type { NoteStore } from '../../src/anki/noteService';
import { sha1Hex } from '../../src/anki/sha1';
import { MemoryRepo } from '../../src/db/repo';
import { WaniKaniError } from '../../src/wanikani/api';
import { makeProductionNotes, PRODUCTION_BATCH, type ProductionDeps } from '../../src/wanikani/productionService';
import { parseAssignment, parseSubject } from '../../src/wanikani/subjects';
import { assignmentResource, kanaVocabResource, vocabResource } from './fixtures';

const NOW = new Date(2026, 10, 12, 12);
const DECK = '👅 Languages::🍥 日本語';

function setup(opts: { passed?: number[]; download?: () => Promise<Uint8Array> } = {}) {
  const repo = new MemoryRepo();
  // Without a kept collection the notes are Franki's own; with one, saveNote writes Anki's too (tested in noteService).
  const store = Object.assign(repo, {
    keptCollection: async () => null,
    lockAnki: <T,>(fn: () => Promise<T>) => fn(),
    withSyncConnection: async () => { throw new Error('no collection'); },
  }) as unknown as NoteStore & MemoryRepo;
  const files = new Map<string, Uint8Array>();
  const pending = new Map<string, string>();
  const passed = (opts.passed ?? [2467, 9001]).map((id, i) => parseAssignment(assignmentResource(i + 1, id, {
    srs_stage: 5, passed_at: `2026-11-0${i + 1}T00:00:00Z`, subject_type: id === 9001 ? 'kana_vocabulary' : 'vocabulary',
  }))!);
  const subjects = [parseSubject(vocabResource)!, parseSubject(kanaVocabResource)!];
  const deps: ProductionDeps = {
    store,
    api: {
      passedVocabulary: async () => passed,
      subjects: async (ids) => subjects.filter((s) => ids.includes(s.id)),
      download: opts.download ?? (async () => new Uint8Array([1, 2, 3])),
    },
    media: {
      exists: (n) => files.has(n),
      read: async (n) => files.get(n),
      write: async (n, b) => { files.set(n, b); },
      recorded: async () => undefined,
      setPending: async (n, s) => { pending.set(n, s); },
    },
  };
  return { deps, store, files, pending };
}

describe('making production notes', () => {
  it('adds a reverse-only Omnilanguage note for each word at Guru, with its recording', async () => {
    const { deps, store, files, pending } = setup();
    const result = await makeProductionNotes(deps, { deck: DECK, maxLevel: 60, made: new Set(), now: NOW });
    expect(result).toEqual({ made: [2467, 9001], waiting: 0 });
    const notes = await store.listNotes();
    expect(notes.map((n) => n.fields.Entry).sort()).toEqual(['ジュース', '大人']);
    const adult = notes.find((n) => n.fields.Entry === '大人')!;
    expect(adult).toMatchObject({ deck: DECK, model: 'Omnilanguage', tags: ['wanikani', 'wanikani::2467'] });
    expect(adult.fields.Audio).toBe('[sound:wanikani-2467-1.mp3]');
    expect((await store.listCards()).filter((c) => c.noteId === adult.id).map((c) => c.kind)).toEqual(['reverse']);
    expect(files.get('wanikani-2467-1.mp3')).toEqual(new Uint8Array([1, 2, 3]));
    expect(pending.get('wanikani-2467-1.mp3')).toBe(sha1Hex(new Uint8Array([1, 2, 3])));
  });

  it('makes nothing twice: not for a word with a note, nor one remembered as made', async () => {
    const { deps, store } = setup();
    await makeProductionNotes(deps, { deck: DECK, maxLevel: 60, made: new Set(), now: NOW });
    expect(await makeProductionNotes(deps, { deck: DECK, maxLevel: 60, made: new Set(), now: NOW })).toEqual({ made: [], waiting: 0 });
    const fresh = setup();
    expect(await makeProductionNotes(fresh.deps, { deck: DECK, maxLevel: 60, made: new Set([2467, 9001]), now: NOW })).toEqual({ made: [], waiting: 0 });
    expect(await fresh.store.listNotes()).toEqual([]);
    expect((await store.listNotes())).toHaveLength(2);
  });

  it('saves the note without a recording when the download fails', async () => {
    const { deps, store, pending } = setup({ passed: [2467], download: async () => { throw new WaniKaniError('unavailable'); } });
    expect((await makeProductionNotes(deps, { deck: DECK, maxLevel: 60, made: new Set(), now: NOW })).made).toEqual([2467]);
    expect((await store.listNotes())[0].fields.Audio).toBeUndefined();
    expect(pending.size).toBe(0);
  });

  it('remembers a word WaniKani no longer has, so it is not asked for again', async () => {
    const { deps } = setup({ passed: [12345] });
    expect(await makeProductionNotes(deps, { deck: DECK, maxLevel: 60, made: new Set(), now: NOW })).toEqual({ made: [12345], waiting: 0 });
  });

  it('works in batches', async () => {
    const ids = Array.from({ length: PRODUCTION_BATCH + 3 }, (_, i) => 100000 + i);
    const { deps } = setup({ passed: ids });
    const result = await makeProductionNotes(deps, { deck: DECK, maxLevel: 60, made: new Set(), now: NOW });
    expect(result.made).toHaveLength(PRODUCTION_BATCH);
    expect(result.waiting).toBe(3);
  });
});
