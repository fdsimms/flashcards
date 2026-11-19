import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { keptSql } from '../../src/anki/attachedSql';
import { utf8Encode } from '../../src/anki/protobuf';
import { DEFAULT_SKILL_SETTINGS, setAnkiSkillSettings, skillSettingsByName, skillSettingsFromConfig } from '../../src/anki/skillSettings';
import { nodeSyncDb } from '../support/syncDb';

const FIXTURE = join(__dirname, '..', 'fixtures', 'anki', 'collection.anki2');
const NOW = new Date(2026, 10, 11, 12);
const LANGUAGES = 1794408857989;

async function kept() {
  const dir = mkdtempSync(join(tmpdir(), 'skillsettings-'));
  copyFileSync(FIXTURE, join(dir, 'collection.anki2'));
  return nodeSyncDb(join(dir, 'collection.anki2'));
}
const read = async (db: Awaited<ReturnType<typeof kept>>) => skillSettingsFromConfig((await db.first<{ val: Uint8Array }>(keptSql('main').skillSettings))?.val);

describe('reading skill settings from a config value', () => {
  it('maps a deck id to its settings, from text or bytes', () => {
    const v = '{"5": {"on": false, "auto": true, "off": ["money", "dates"]}}';
    const want = new Map([[5, { on: false, auto: true, off: ['dates', 'money'] }]]);
    expect(skillSettingsFromConfig(v)).toEqual(want);
    expect(skillSettingsFromConfig(utf8Encode(v))).toEqual(want);
  });

  it("takes the default for what's missing and drops what isn't a skill group", () => {
    expect(skillSettingsFromConfig('{"5": {"auto": true, "off": ["money", "nope", 3]}, "6": 7, "x": {}}')).toEqual(new Map([
      [5, { on: true, auto: true, off: ['money'] }],
      [6, DEFAULT_SKILL_SETTINGS],
    ]));
    for (const bad of [undefined, null, '', 'nope', '[1]', '3']) expect(skillSettingsFromConfig(bad)).toEqual(new Map());
  });

  it('names the decks the collection still has', () => {
    const decks = [{ id: 5, name: 'Thai' }, { id: 6, name: 'Thai::Skills' }];
    expect([...skillSettingsByName(decks, '{"5": {"auto": true}, "99": {"auto": true}}').keys()]).toEqual(['Thai']);
  });
});

describe("a deck's skill settings in the kept collection", () => {
  it('saves them where a sync sends them, and the defaults remove them', async () => {
    const db = await kept();
    expect(await setAnkiSkillSettings(db, '👅 Languages', { on: true, auto: true, off: ['money'] }, NOW)).toBe(true);
    expect(await read(db)).toEqual(new Map([[LANGUAGES, { on: true, auto: true, off: ['money'] }]]));
    const row = await db.first<{ usn: number }>("SELECT usn FROM config WHERE KEY = 'frankiSkillCards'");
    expect(row?.usn).toBe(-1);
    expect(await setAnkiSkillSettings(db, '👅 Languages', DEFAULT_SKILL_SETTINGS, NOW)).toBe(true);
    expect(await read(db)).toEqual(new Map());
    db.close();
  });

  it('keeps other decks\' settings, and says when Anki has no such deck', async () => {
    const db = await kept();
    await setAnkiSkillSettings(db, '👅 Languages', { on: false, auto: false, off: [] }, NOW);
    expect(await setAnkiSkillSettings(db, 'Nope', { on: false, auto: true, off: [] }, NOW)).toBe(false);
    expect((await read(db)).get(LANGUAGES)).toEqual({ on: false, auto: false, off: [] });
    db.close();
  });
});
