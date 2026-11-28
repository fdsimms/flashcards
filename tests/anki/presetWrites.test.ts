import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readDeckConfig, readDeckKind } from '../../src/anki/collection';
import { decodeMessage, uint } from '../../src/anki/protobuf';
import { readAnkiDeckNewLimit, readAnkiPreset, setAnkiDeckNewLimit, setAnkiNewMix, setAnkiPresetOptions } from '../../src/anki/presetWrites';
import { deckConfigJson } from '../../src/anki/sync/deckConfigRow';
import { nodeSyncDb } from '../support/syncDb';

const FIXTURE = join(__dirname, '..', 'fixtures', 'anki', 'collection.anki2');
const NOW = new Date(2026, 10, 11, 12);

async function kept() {
  const dir = mkdtempSync(join(tmpdir(), 'preset-'));
  copyFileSync(FIXTURE, join(dir, 'collection.anki2'));
  const db = await nodeSyncDb(join(dir, 'collection.anki2'), { unicase: true });
  await db.run('UPDATE deck_config SET usn = 0');
  return db;
}
const preset = async (db: Awaited<ReturnType<typeof kept>>) =>
  (await db.first<{ id: number; config: Uint8Array; mtime_secs: number; usn: number }>('SELECT id, config, mtime_secs, usn FROM deck_config ORDER BY id LIMIT 1'))!;

describe("a preset's new card order in the kept collection", () => {
  it('sets the order, marks the preset unsent and the collection modified, and keeps every other setting', async () => {
    const db = await kept();
    const before = await preset(db);
    expect(await setAnkiNewMix(db, before.id, 1, NOW)).toBe(true);
    const after = await preset(db);
    expect(readDeckConfig(after.config)).toEqual({ ...readDeckConfig(before.config), newMix: 1 });
    expect(after).toMatchObject({ usn: -1, mtime_secs: Math.floor(NOW.getTime() / 1000) });
    expect((await db.first<{ mod: number }>('SELECT mod FROM col'))!.mod).toBe(NOW.getTime());
    db.close();
  });

  it('writes the mix back to Anki\'s default (field left out) and keeps other fields exactly as they were', async () => {
    const db = await kept();
    const { id, config } = await preset(db);
    await setAnkiNewMix(db, id, 2, NOW);
    await setAnkiNewMix(db, id, 0, NOW);
    const msg = decodeMessage((await preset(db)).config);
    expect(uint(msg, 30)).toBeUndefined();
    // Every field other than the order is as Anki wrote it, in the same order.
    const fields = (b: Uint8Array) => [...decodeMessage(b)].filter(([n]) => n !== 30).map(([n, f]) => [n, f.map((x) => String(x.value))]);
    expect(fields((await preset(db)).config)).toEqual(fields(config));
    db.close();
  });

  it('changes nothing when the order is already set', async () => {
    const db = await kept();
    const { id } = await preset(db);
    expect(await setAnkiNewMix(db, id, 0, NOW)).toBe(true);
    expect(await preset(db)).toMatchObject({ usn: 0 });
    db.close();
  });

  it('is false for a preset Anki does not have', async () => {
    const db = await kept();
    expect(await setAnkiNewMix(db, 12345, 1, NOW)).toBe(false);
    db.close();
  });
});

describe("a preset's limits, steps, maximum interval and retention in the kept collection", () => {
  const THAI = 1794408857993;

  it('reads the options and every deck on the preset, with the values a deck keeps for itself', async () => {
    const db = await kept();
    const def = (await readAnkiPreset(db, 1))!;
    expect(def.name).toBe('Default');
    expect(def.options).toMatchObject({ learnSteps: [1, 10], relearnSteps: [10], maxInterval: 36500, desiredRetention: 0.9 });
    expect(def.decks.map((d) => d.name)).toEqual(['👅 Languages', '🧠 Trivia']);
    expect(def.decks.find((d) => d.name === '🧠 Trivia')!.own).toEqual({ newPerDay: 3 });
    expect((await readAnkiPreset(db, THAI))!.decks.map((d) => d.name)).toEqual(['👅 Languages::🐘 ภาษาไทย']);
    expect(await readAnkiPreset(db, 12345)).toBeNull();
    db.close();
  });

  it('writes what changed as Anki keeps it, marks the preset unsent, and keeps every other setting', async () => {
    const db = await kept();
    const before = await preset(db);
    const options = { newPerDay: 15, reviewsPerDay: 150, learnSteps: [1, 10, 60], relearnSteps: [], maxInterval: 365, desiredRetention: 0.85 };
    expect(await setAnkiPresetOptions(db, before.id, options, NOW)).toBe(true);
    const after = await preset(db);
    expect(readDeckConfig(after.config)).toEqual({ ...readDeckConfig(before.config), ...options });
    expect(after).toMatchObject({ usn: -1, mtime_secs: Math.floor(NOW.getTime() / 1000) });
    expect((await readAnkiPreset(db, before.id))!.options).toEqual(options);
    // What sync sends (Anki's own JSON) carries the new values.
    const json = deckConfigJson({ id: after.id, name: 'Default', mtime: after.mtime_secs, usn: -1, config: after.config });
    expect(json).toMatchObject({ new: { perDay: 15, delays: [1, 10, 60] }, rev: { perDay: 150, maxIvl: 365 }, lapse: { delays: [] } });
    expect(json.desiredRetention).toBeCloseTo(0.85, 5);
    // Fields Franki didn't change are as Anki wrote them, in the same order.
    const changed = new Set([1, 2, 9, 10, 16, 37]);
    const fields = (b: Uint8Array) => [...decodeMessage(b)].filter(([n]) => !changed.has(n)).map(([n, f]) => [n, f.map((x) => String(x.value))]);
    expect(fields(after.config)).toEqual(fields(before.config));
    db.close();
  });

  it('changes nothing when the options are already set, and is false for a preset Anki does not have', async () => {
    const db = await kept();
    const { id } = await preset(db);
    expect(await setAnkiPresetOptions(db, id, (await readAnkiPreset(db, id))!.options, NOW)).toBe(true);
    expect(await preset(db)).toMatchObject({ usn: 0 });
    expect(await setAnkiPresetOptions(db, 12345, (await readAnkiPreset(db, id))!.options, NOW)).toBe(false);
    db.close();
  });
});

describe("a deck's own daily new card limit in the kept collection", () => {
  const deckRow = async (db: Awaited<ReturnType<typeof kept>>, name: string) =>
    (await db.all<{ id: number; name: string; kind: Uint8Array; usn: number; mtime_secs: number }>('SELECT id, name, kind, usn, mtime_secs FROM decks NOT INDEXED')).find((d) => d.name === name.split('::').join('\x1f'))!;

  it('sets the deck’s own limit, leaves its preset and the other decks on it alone, and marks the deck unsent', async () => {
    const db = await kept();
    await db.run('UPDATE decks SET usn = 0');
    const before = await deckRow(db, '👅 Languages');
    const presetBefore = await preset(db);
    expect(await setAnkiDeckNewLimit(db, '👅 Languages', 6, NOW)).toBe(true);
    const def = (await readAnkiPreset(db, 1))!;
    expect(def.decks.find((d) => d.name === '👅 Languages')!.own).toEqual({ newPerDay: 6 });
    expect(def.decks.find((d) => d.name === '🧠 Trivia')!.own).toEqual({ newPerDay: 3 });
    expect(await preset(db)).toEqual(presetBefore);
    const after = await deckRow(db, '👅 Languages');
    expect(after).toMatchObject({ usn: -1, mtime_secs: Math.floor(NOW.getTime() / 1000) });
    expect(readDeckKind(after.kind)).toEqual({ ...readDeckKind(before.kind), newLimit: 6 });
    expect((await db.first<{ mod: number }>('SELECT mod FROM col'))!.mod).toBe(NOW.getTime());
    db.close();
  });

  it('writes 0 as no new cards rather than leaving the limit out, and changes nothing when it is already set', async () => {
    const db = await kept();
    expect(await setAnkiDeckNewLimit(db, '🧠 Trivia', 0, NOW)).toBe(true);
    expect(readDeckKind((await deckRow(db, '🧠 Trivia')).kind)?.newLimit).toBe(0);
    await db.run('UPDATE decks SET usn = 0');
    expect(await setAnkiDeckNewLimit(db, '🧠 Trivia', 0, new Date(2026, 10, 12, 12))).toBe(true);
    expect((await deckRow(db, '🧠 Trivia')).usn).toBe(0);
    db.close();
  });

  it('is false for a deck Anki does not have', async () => {
    const db = await kept();
    expect(await setAnkiDeckNewLimit(db, 'Nope', 5, NOW)).toBe(false);
    db.close();
  });

  it('takes the limit off with null, so the deck follows its preset again, and reads it back', async () => {
    const db = await kept();
    expect(await readAnkiDeckNewLimit(db, '🧠 Trivia')).toBe(3);
    expect(await setAnkiDeckNewLimit(db, '🧠 Trivia', null, NOW)).toBe(true);
    expect(readDeckKind((await deckRow(db, '🧠 Trivia')).kind)?.newLimit).toBeUndefined();
    expect((await readAnkiPreset(db, 1))!.decks.find((d) => d.name === '🧠 Trivia')!.own).toEqual({});
    expect(await readAnkiDeckNewLimit(db, '🧠 Trivia')).toBeNull();
    expect(await readAnkiDeckNewLimit(db, 'Nope')).toBeUndefined();
    db.close();
  });
});
