import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { keptSql } from '../../src/anki/attachedSql';
import { gatesByName, gatesFromConfig, PROGRESS_GATES_KEY, setAnkiProgressGate, withCollectionGates } from '../../src/anki/progressGates';
import { utf8Encode } from '../../src/anki/protobuf';
import { MAX_GATE_CAP } from '../../src/core/progress';
import { nodeSyncDb } from '../support/syncDb';

const FIXTURE = join(__dirname, '..', 'fixtures', 'anki', 'collection.anki2');
const NOW = new Date(2026, 10, 11, 12);
const LANGUAGES = 1794408857989;
const TRIVIA = 1794408857991;

async function kept() {
  const dir = mkdtempSync(join(tmpdir(), 'gates-'));
  copyFileSync(FIXTURE, join(dir, 'collection.anki2'));
  return nodeSyncDb(join(dir, 'collection.anki2'));
}

describe('reading the gates in a config value', () => {
  it('maps a deck id to its cap, from text or bytes', () => {
    expect(gatesFromConfig('{"5": 40, "7": 1}')).toEqual(new Map([[5, 40], [7, 1]]));
    expect(gatesFromConfig(utf8Encode('{"5": 40}'))).toEqual(new Map([[5, 40]]));
  });

  it('drops what a gate can\'t be, rather than guessing', () => {
    expect(gatesFromConfig('{"5": 0, "6": 2.5, "7": "40", "8": 5001, "x": 3, "9": 5000}')).toEqual(new Map([[9, MAX_GATE_CAP]]));
    for (const bad of [undefined, null, '', 'nope', '[1, 2]', '3', 'null']) expect(gatesFromConfig(bad)).toEqual(new Map());
  });

  it('names the decks the collection still has, and leaves out a deleted one', () => {
    const decks = [{ id: 5, name: 'Polski' }, { id: 6, name: 'Polski::Odmiana' }];
    expect(gatesByName(decks, '{"5": 40, "99": 10}')).toEqual(new Map([['Polski', 40]]));
  });
});

describe("a deck's gate in the settings", () => {
  const anki = new Set(['Polski', 'Deutsch']);

  it("takes a deck Anki has from the collection, over what the phone saved", () => {
    const { settings, unmoved } = withCollectionGates(new Map([['Polski', { gateCap: 10, collapsed: true }]]), new Map([['Polski', 40]]), anki);
    expect(settings.get('Polski')).toEqual({ gateCap: 40, collapsed: true });
    expect(unmoved.size).toBe(0);
  });

  it("gives a deck with settings of no other kind its gate too", () => {
    expect(withCollectionGates(new Map(), new Map([['Deutsch', 25]]), anki).settings.get('Deutsch')).toEqual({ gateCap: 25 });
  });

  it("keeps a gate saved on the phone before gates moved, and says it still has to move", () => {
    const local = new Map([['Polski', { gateCap: 30 }], ['Mine', { gateCap: 5 }]]);
    const { settings, unmoved } = withCollectionGates(local, new Map(), anki);
    expect(settings.get('Polski')?.gateCap).toBe(30);
    expect(unmoved).toEqual(new Map([['Polski', 30]]));
    // A deck Anki doesn't have keeps the phone's gate, and has nothing to move.
    expect(settings.get('Mine')?.gateCap).toBe(5);
  });

  it("doesn't change the settings it was given", () => {
    const local = new Map([['Polski', { gateCap: 10 }]]);
    withCollectionGates(local, new Map([['Polski', 40]]), anki);
    expect(local.get('Polski')?.gateCap).toBe(10);
  });
});

describe("a gate in the kept collection", () => {
  const read = async (db: Awaited<ReturnType<typeof kept>>) => gatesFromConfig((await db.first<{ val: Uint8Array }>(keptSql('main').gates))?.val);

  it('is written as a config row a sync will send, by deck id', async () => {
    const db = await kept();
    expect(await setAnkiProgressGate(db, '👅 Languages', 40, NOW)).toBe(true);
    expect(await read(db)).toEqual(new Map([[LANGUAGES, 40]]));
    const row = (await db.first<{ usn: number; mtime_secs: number }>('SELECT usn, mtime_secs FROM config WHERE KEY = ?', PROGRESS_GATES_KEY))!;
    expect([row.usn, row.mtime_secs]).toEqual([-1, Math.floor(NOW.getTime() / 1000)]);
    expect((await db.first<{ mod: number }>('SELECT mod FROM col'))!.mod).toBe(NOW.getTime());
    db.close();
  });

  it('changes and removes one gate without touching the others', async () => {
    const db = await kept();
    await setAnkiProgressGate(db, '👅 Languages', 40, NOW);
    await setAnkiProgressGate(db, '🧠 Trivia', 10, NOW);
    await setAnkiProgressGate(db, '👅 Languages', 60, NOW);
    expect(await read(db)).toEqual(new Map([[LANGUAGES, 60], [TRIVIA, 10]]));
    await setAnkiProgressGate(db, '👅 Languages', undefined, NOW);
    expect(await read(db)).toEqual(new Map([[TRIVIA, 10]]));
    db.close();
  });

  it("writes nothing when the gate is already that, so a sync has nothing to send", async () => {
    const db = await kept();
    await setAnkiProgressGate(db, '👅 Languages', 40, NOW);
    const later = new Date(2026, 10, 12, 12);
    await setAnkiProgressGate(db, '👅 Languages', 40, later);
    await setAnkiProgressGate(db, '🧠 Trivia', undefined, later);
    expect((await db.first<{ mod: number }>('SELECT mod FROM col'))!.mod).toBe(NOW.getTime());
    db.close();
  });

  it('says when Anki has no such deck, and refuses a cap a gate can\'t have', async () => {
    const db = await kept();
    expect(await setAnkiProgressGate(db, 'Nope', 5, NOW)).toBe(false);
    expect(await db.first(keptSql('main').gates)).toBeNull();
    for (const bad of [0, 1.5, MAX_GATE_CAP + 1]) await expect(setAnkiProgressGate(db, '🧠 Trivia', bad, NOW)).rejects.toThrow(RangeError);
    db.close();
  });
});
