import { describe, expect, it } from 'vitest';
import { recordNote, recordNotes, type RecordDeps } from '../../src/anki/recordService';
import { sha1Hex } from '../../src/anki/sha1';
import type { NoteStore } from '../../src/anki/noteService';
import { makeCards } from '../../src/core/cards';
import { MemoryRepo } from '../../src/db/repo';
import { NOW, omniNote } from '../support/fixtures';

/** Franki with no Anki collection (the note service's Anki side is tested in noteService.test.ts). */
async function franki(notes = [omniNote()]) {
  const repo = new MemoryRepo();
  await repo.upsertNotesAndCards(notes, notes.flatMap((n) => makeCards(n, NOW)));
  const store = Object.assign(repo, {
    keptCollection: async () => null,
    lockAnki: <T,>(fn: () => Promise<T>) => fn(),
    withSyncConnection: async () => { throw new Error('no collection'); },
  }) as NoteStore & MemoryRepo;
  const files = new Map<string, Uint8Array>();
  const pending = new Map<string, string>();
  const recorded = new Map<string, string>();
  const spoken: string[] = [];
  const deps: RecordDeps = {
    store,
    speak: async (text, voice, _rate, language) => { spoken.push(`${voice}:${language}:${text}`); return new TextEncoder().encode(`mp3 ${text}`); },
    media: {
      exists: (n) => files.has(n),
      read: async (n) => files.get(n),
      write: async (n, b) => { files.set(n, b); },
      recorded: async (n) => recorded.get(n),
      setPending: async (n, s) => { pending.set(n, s); },
    },
  };
  return { store, deps, files, pending, recorded, spoken };
}

const VOICE = 'th-TH-PremwadeeNeural';

describe('recording notes', () => {
  it('keeps the file, puts it on the list to send, and points Audio at it', async () => {
    const f = await franki();
    const saved = await recordNote(f.deps, 'n1', VOICE);
    const name = saved!.fields.Audio.match(/\[sound:(.+)\]/)![1];
    // The note's language goes with it, for a Multilingual voice.
    expect(f.spoken).toEqual([`${VOICE}:th-TH:หนังสือ`]);
    expect(new TextDecoder().decode(f.files.get(name))).toBe('mp3 หนังสือ');
    expect(f.pending.get(name)).toBe(sha1Hex(f.files.get(name)!));
    expect((await f.store.getNote('n1'))!.fields.Audio).toBe(`[sound:${name}]`);
  });

  it('uses a file already here, and sends nothing the server already has', async () => {
    const f = await franki();
    const first = await recordNote(f.deps, 'n1', VOICE);
    const name = first!.fields.Audio.slice(7, -1);
    f.pending.clear();
    f.recorded.set(name, sha1Hex(f.files.get(name)!));
    await f.store.upsertNotesAndCards([omniNote()], []);
    await recordNote(f.deps, 'n1', VOICE);
    expect(f.spoken).toHaveLength(1);
    expect(f.pending.size).toBe(0);
  });

  it('leaves a note alone that has a recording, or whose Entry changed while the server spoke', async () => {
    const f = await franki([omniNote({ Audio: '[sound:mine.mp3]' })]);
    expect(await recordNote(f.deps, 'n1', VOICE)).toBeUndefined();
    expect(f.spoken).toEqual([]);

    const g = await franki();
    g.deps.speak = async (text) => {
      await g.store.upsertNotesAndCards([omniNote({ Entry: 'แมว' })], []);
      return new TextEncoder().encode(text);
    };
    expect(await recordNote(g.deps, 'n1', VOICE)).toBeUndefined();
    expect((await g.store.getNote('n1'))!.fields.Audio).toBe('');
  });

  it('records one at a time and stops at the first failure, saying why', async () => {
    const notes = [omniNote(), { ...omniNote({ Entry: 'แมว' }), id: 'n2' }, { ...omniNote({ Entry: 'หมา' }), id: 'n3' }];
    const f = await franki(notes);
    const speak = f.deps.speak;
    f.deps.speak = async (text, voice, rate) => {
      if (text === 'หมา') throw new Error("Couldn't reach the server.");
      return speak(text, voice, rate);
    };
    const progress: number[] = [];
    const r = await recordNotes(f.deps, notes.map((note) => ({ note, voice: VOICE })), (n) => progress.push(n));
    expect(r.recorded).toBe(2);
    expect(r.stopped).toEqual(new Error("Couldn't reach the server."));
    expect(progress).toEqual([1, 2]);
  });
});
