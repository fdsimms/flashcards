import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { keptSql } from '../../src/anki/attachedSql';
import { DAILY_GOALS_KEY, dailyGoalsByName, GOAL_REPLACED_KEY, goalReplacedByName, setAnkiDailyGoal, setAnkiGoalReplaced, withCollectionGoals } from '../../src/anki/dailyGoals';
import { gatesByName, PROGRESS_GATES_KEY, setAnkiProgressGate } from '../../src/anki/progressGates';
import { MAX_DAILY_GOAL } from '../../src/core/dailyGoal';
import { nodeSyncDb } from '../support/syncDb';

const FIXTURE = join(__dirname, '..', 'fixtures', 'anki', 'collection.anki2');
const NOW = new Date(2026, 10, 11, 12);
const LANGUAGES = 1794408857989;
const TRIVIA = 1794408857991;
const DECKS = [{ id: LANGUAGES, name: '👅 Languages' }, { id: TRIVIA, name: '🧠 Trivia' }];

async function kept() {
  const dir = mkdtempSync(join(tmpdir(), 'goals-'));
  copyFileSync(FIXTURE, join(dir, 'collection.anki2'));
  return nodeSyncDb(join(dir, 'collection.anki2'));
}

describe('reading the goals in a config value', () => {
  it('names each deck the collection has with its goal, and drops what a goal can\'t be', () => {
    expect(dailyGoalsByName(DECKS, `{"${LANGUAGES}": 120, "${TRIVIA}": 0, "99": 40}`)).toEqual(new Map([['👅 Languages', 120]]));
    expect(dailyGoalsByName(DECKS, `{"${LANGUAGES}": ${MAX_DAILY_GOAL + 1}, "${TRIVIA}": 2.5}`)).toEqual(new Map());
    for (const bad of [undefined, null, '', 'nope', '[1]']) expect(dailyGoalsByName(DECKS, bad)).toEqual(new Map());
  });
});

describe("a deck's goal in the settings", () => {
  const anki = new Set(['Polski', 'Deutsch']);

  it('takes a deck Anki has from the collection, and a deck Anki doesn\'t have keeps the phone\'s', () => {
    const local = new Map([['Polski', { gateCap: 10 }], ['Mine', { dailyGoal: 30 }]]);
    const settings = withCollectionGoals(local, new Map([['Polski', 80], ['Deutsch', 40]]), new Map(), anki);
    expect(settings.get('Polski')).toEqual({ gateCap: 10, dailyGoal: 80 });
    expect(settings.get('Deutsch')).toEqual({ dailyGoal: 40 });
    expect(settings.get('Mine')).toEqual({ dailyGoal: 30 });
    expect(local.get('Polski')).toEqual({ gateCap: 10 });
  });

  it('has no goal for a deck Anki has with none in the collection, whatever the phone kept', () => {
    expect(withCollectionGoals(new Map([['Polski', { dailyGoal: 50 }]]), new Map(), new Map(), anki).get('Polski')?.dailyGoal).toBeUndefined();
  });

  it("takes what a deck Anki has replaced from the collection, so any device puts it back; a deck Anki doesn't have keeps the phone's", () => {
    const local = new Map([['Polski', { dailyGoal: 80, goalReplaced: 12 }], ['Deutsch', { dailyGoal: 40, goalReplaced: 3 }], ['Mine', { dailyGoal: 30, goalReplaced: 5 }]]);
    const settings = withCollectionGoals(local, new Map([['Polski', 80], ['Deutsch', 40]]), new Map([['Polski', null]]), anki);
    expect(settings.get('Polski')?.goalReplaced).toBeNull();
    expect(settings.get('Mine')?.goalReplaced).toBe(5);
    // Kept on the phone before it was kept in the collection: it stays while the goal does, for the next save to move.
    expect(settings.get('Deutsch')?.goalReplaced).toBe(3);
    // The goal turned off on another device: that one put the value back, so this phone's copy goes.
    expect(withCollectionGoals(local, new Map(), new Map(), anki).get('Deutsch')?.goalReplaced).toBeUndefined();
  });
});

describe('a goal in the kept collection', () => {
  const read = async (db: Awaited<ReturnType<typeof kept>>) => dailyGoalsByName(DECKS, (await db.first<{ val: Uint8Array }>(keptSql('main').dailyGoals))?.val);

  it('is written as a config row a sync will send, beside the gates and apart from them', async () => {
    const db = await kept();
    await setAnkiProgressGate(db, '🧠 Trivia', 10, NOW);
    expect(await setAnkiDailyGoal(db, '👅 Languages', 120, NOW)).toBe(true);
    expect(await read(db)).toEqual(new Map([['👅 Languages', 120]]));
    expect(gatesByName(DECKS, (await db.first<{ val: Uint8Array }>(keptSql('main').gates))?.val)).toEqual(new Map([['🧠 Trivia', 10]]));
    const row = (await db.first<{ usn: number }>('SELECT usn FROM config WHERE KEY = ?', DAILY_GOALS_KEY))!;
    expect(row.usn).toBe(-1);
    expect(DAILY_GOALS_KEY).not.toBe(PROGRESS_GATES_KEY);
    await setAnkiDailyGoal(db, '👅 Languages', undefined, NOW);
    expect(await read(db)).toEqual(new Map());
    db.close();
  });

  it('keeps what a goal replaced beside it, "none of its own" included, and takes it off with undefined', async () => {
    const db = await kept();
    const replaced = async () => goalReplacedByName(DECKS, (await db.first<{ val: Uint8Array }>(keptSql('main').goalReplaced))?.val);
    expect(await setAnkiGoalReplaced(db, '👅 Languages', null, NOW)).toBe(true);
    expect(await setAnkiGoalReplaced(db, '🧠 Trivia', 0, NOW)).toBe(true);
    expect(await replaced()).toEqual(new Map<string, number | null>([['👅 Languages', null], ['🧠 Trivia', 0]]));
    expect((await db.first<{ usn: number }>('SELECT usn FROM config WHERE KEY = ?', GOAL_REPLACED_KEY))!.usn).toBe(-1);
    await setAnkiGoalReplaced(db, '👅 Languages', undefined, NOW);
    expect(await replaced()).toEqual(new Map([['🧠 Trivia', 0]]));
    await expect(setAnkiGoalReplaced(db, '🧠 Trivia', -2, NOW)).rejects.toThrow(RangeError);
    db.close();
  });

  it('says when Anki has no such deck, and refuses a goal out of range', async () => {
    const db = await kept();
    expect(await setAnkiDailyGoal(db, 'Nope', 5, NOW)).toBe(false);
    for (const bad of [0, 1.5, MAX_DAILY_GOAL + 1]) await expect(setAnkiDailyGoal(db, '🧠 Trivia', bad, NOW)).rejects.toThrow(RangeError);
    db.close();
  });
});
