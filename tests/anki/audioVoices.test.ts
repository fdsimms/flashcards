import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUDIO_VOICES_KEY, audioVoicesFromConfig, setAnkiAudioVoice } from '../../src/anki/audioVoices';
import { utf8Encode } from '../../src/anki/protobuf';
import { nodeSyncDb } from '../support/syncDb';

const FIXTURE = join(__dirname, '..', 'fixtures', 'anki', 'collection.anki2');
const NOW = new Date(2026, 10, 11, 12);
const THAI = { voice: 'th-TH-PremwadeeNeural', rate: 1 };

async function kept() {
  const dir = mkdtempSync(join(tmpdir(), 'audiovoices-'));
  copyFileSync(FIXTURE, join(dir, 'collection.anki2'));
  return nodeSyncDb(join(dir, 'collection.anki2'));
}
const read = async (db: Awaited<ReturnType<typeof kept>>) =>
  audioVoicesFromConfig((await db.first<{ val: Uint8Array }>('SELECT val FROM config WHERE KEY = ?', AUDIO_VOICES_KEY))?.val);

describe('reading the voices from a config value', () => {
  it('maps a language code to its voice, from text or bytes', () => {
    const v = '{"th": {"voice": "th-TH-PremwadeeNeural", "rate": 0.9}, "pl": {"voice": "x", "rate": 1, "locale": "pl-PL"}}';
    const want = new Map([['th', { voice: 'th-TH-PremwadeeNeural', rate: 0.9 }], ['pl', { voice: 'x', rate: 1, locale: 'pl-PL' }]]);
    expect(audioVoicesFromConfig(v)).toEqual(want);
    expect(audioVoicesFromConfig(utf8Encode(v))).toEqual(want);
  });

  it('drops what is not a voice and takes normal speed for a bad rate', () => {
    expect(audioVoicesFromConfig('{"th": {"voice": "v", "rate": 9}, "de": {"rate": 1}, "es": 3, "fr": {"voice": ""}}'))
      .toEqual(new Map([['th', { voice: 'v', rate: 1 }]]));
    for (const bad of [undefined, null, '', 'nope', '[1]', '3']) expect(audioVoicesFromConfig(bad)).toEqual(new Map());
  });
});

describe("a language's voice in the kept collection", () => {
  it('saves it where a sync sends it, and with none removes it', async () => {
    const db = await kept();
    await setAnkiAudioVoice(db, 'th', THAI, NOW);
    expect(await read(db)).toEqual(new Map([['th', THAI]]));
    expect((await db.first<{ usn: number }>('SELECT usn FROM config WHERE KEY = ?', AUDIO_VOICES_KEY))?.usn).toBe(-1);
    await setAnkiAudioVoice(db, 'th', null, NOW);
    expect(await read(db)).toEqual(new Map());
    db.close();
  });

  it("changes only that language's entry", async () => {
    const db = await kept();
    await setAnkiAudioVoice(db, 'pl', { voice: 'pl-PL-ZofiaNeural', rate: 1, locale: 'pl-PL' }, NOW);
    await setAnkiAudioVoice(db, 'th', THAI, NOW);
    await setAnkiAudioVoice(db, 'th', null, NOW);
    expect([...(await read(db)).keys()]).toEqual(['pl']);
    db.close();
  });

  it('writes nothing when the entry already says it', async () => {
    const db = await kept();
    await setAnkiAudioVoice(db, 'th', THAI, NOW);
    const before = await db.first<{ mtime_secs: number }>('SELECT mtime_secs FROM config WHERE KEY = ?', AUDIO_VOICES_KEY);
    await setAnkiAudioVoice(db, 'th', THAI, new Date(2026, 10, 12, 12));
    await setAnkiAudioVoice(db, 'de', null, new Date(2026, 10, 12, 12));
    const after = await db.first<{ mtime_secs: number }>('SELECT mtime_secs FROM config WHERE KEY = ?', AUDIO_VOICES_KEY);
    expect(after?.mtime_secs).toBe(before?.mtime_secs);
    db.close();
  });
});
