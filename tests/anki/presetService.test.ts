import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildExport } from '../../src/anki/collection';
import type { NoteStore } from '../../src/anki/noteService';
import { loadPreset, PresetRefused, savePreset } from '../../src/anki/presetService';
import { studyDayKey } from '../../src/core/day';
import { MemoryRepo } from '../../src/db/repo';
import { importAnkiJson } from '../../src/import/ankiJson';
import { readCollectionRows } from '../support/ankiRows';
import { nodeSyncDb } from '../support/syncDb';

const FIXTURE = join(__dirname, '..', 'fixtures', 'anki', 'collection.anki2');
const NOW = new Date(2026, 10, 11, 12);
const TRIVIA = '🧠 Trivia';
const LANGUAGES = '👅 Languages';
const THAI = '👅 Languages::🐘 ภาษาไทย';

async function franki(opts: { kept?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'presetsvc-'));
  const kept = join(dir, 'collection.anki2');
  copyFileSync(FIXTURE, kept);
  const repo = new MemoryRepo();
  const data = importAnkiJson(buildExport(await readCollectionRows(kept)), { now: NOW });
  await repo.saveNoteTypes(data.noteTypes ?? []);
  await repo.applyAnkiCollection(data.notes, data.cards);
  if (data.deckParams?.size) await repo.saveDeckParams(data.deckParams);
  const store = Object.assign(repo, {
    keptCollection: async () => (opts.kept === false ? null : {}),
    lockAnki: <T,>(fn: () => Promise<T>) => fn(),
    withSyncConnection: async <T,>(fn: (db: Awaited<ReturnType<typeof nodeSyncDb>>) => Promise<T>) => {
      const db = await nodeSyncDb(kept, { unicase: true });
      try { return await fn(db); } finally { db.close(); }
    },
  }) as NoteStore & MemoryRepo;
  return { store, kept };
}

const OPTIONS = { newPerDay: 15, reviewsPerDay: 150, learnSteps: [1, 10, 60], relearnSteps: [5], maxInterval: 365, desiredRetention: 0.85 };

describe("a deck's Anki preset options", () => {
  it('lists every deck the preset applies to, and what each keeps for itself', async () => {
    const { store } = await franki();
    const v = await loadPreset(store, TRIVIA, NOW);
    expect(v.presetName).toBe('Default');
    expect(v.decks).toEqual([{ name: LANGUAGES, own: {} }, { name: TRIVIA, own: { newPerDay: 3 } }]);
    expect((await loadPreset(store, THAI, NOW)).decks.map((d) => d.name)).toEqual([THAI]);
  });

  it("marks a deck with a today-only limit for today, and not one set on another day", async () => {
    const { store } = await franki();
    const params = await store.listDeckParams();
    const today = studyDayKey(NOW, (await store.collectionSettings()).dayStartsAtHour);
    await store.saveDeckParams(new Map([
      [LANGUAGES, { ...params.get(LANGUAGES)!, newLimitToday: { limit: 40, day: today } }],
      [TRIVIA, { ...params.get(TRIVIA)!, reviewLimitToday: { limit: 40, day: '2026-11-01' } }],
    ]));
    const v = await loadPreset(store, TRIVIA, NOW);
    expect(v.decks.find((d) => d.name === LANGUAGES)!.own).toEqual({ newToday: true });
    expect(v.decks.find((d) => d.name === TRIVIA)!.own).toEqual({ newPerDay: 3 });
  });

  it("saves to the collection and to every deck of Franki's on the preset, a deck's own limit still winning", async () => {
    const { store } = await franki();
    const v = await loadPreset(store, TRIVIA, NOW);
    const thaiBefore = (await store.listDeckParams()).get(THAI)!;
    await savePreset(store, TRIVIA, v.presetId, OPTIONS, NOW);
    expect((await loadPreset(store, TRIVIA, NOW)).options).toEqual(OPTIONS);
    const params = await store.listDeckParams();
    expect(params.get(LANGUAGES)).toMatchObject(OPTIONS);
    expect(params.get(TRIVIA)).toMatchObject({ ...OPTIONS, newPerDay: 3 });
    // Another preset's deck is untouched.
    expect(params.get(THAI)).toEqual(thaiBefore);
  });

  it('refuses a deck with no preset, a Franki with no Anki collection, and a preset that is no longer the deck\'s', async () => {
    const { store } = await franki();
    await expect(loadPreset(store, 'Nope', NOW)).rejects.toBeInstanceOf(PresetRefused);
    const none = await franki({ kept: false });
    await expect(loadPreset(none.store, TRIVIA, NOW)).rejects.toThrow('Anki collection');
    const thai = await loadPreset(store, THAI, NOW);
    await expect(savePreset(store, TRIVIA, thai.presetId, OPTIONS, NOW)).rejects.toThrow('changed while you were editing');
    expect((await loadPreset(store, THAI, NOW)).options).toEqual(thai.options);
  });
});
