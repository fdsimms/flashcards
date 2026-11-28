import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NATIVE_OFF, NATIVE_RECORDINGS_KEY, nativeConfigFromValue, nativeWanted, setAnkiNativeRecordings } from '../../src/anki/nativeRecordings';
import { utf8Encode } from '../../src/anki/protobuf';
import { nodeSyncDb } from '../support/syncDb';

const FIXTURE = join(__dirname, '..', 'fixtures', 'anki', 'collection.anki2');
const NOW = new Date(2026, 10, 28, 12);

describe('the native recordings setting', () => {
  it('is off until turned on, and then on except for Thai and Greek unless chosen', () => {
    expect(nativeWanted(NATIVE_OFF, 'de')).toBe(false);
    const on = { on: true, languages: {} };
    expect(nativeWanted(on, 'de')).toBe(true);
    expect(nativeWanted(on, 'th')).toBe(false);
    expect(nativeWanted({ on: true, languages: { th: true, de: false } }, 'th')).toBe(true);
    expect(nativeWanted({ on: true, languages: { de: false } }, 'de')).toBe(false);
  });

  it('reads what the MCP reads, from text or bytes, dropping anything else', () => {
    const v = '{"on": true, "languages": {"th": true, "de": "yes"}}';
    expect(nativeConfigFromValue(v)).toEqual({ on: true, languages: { th: true } });
    expect(nativeConfigFromValue(utf8Encode(v))).toEqual({ on: true, languages: { th: true } });
    for (const bad of [undefined, null, '', 'nope', '[1]']) expect(nativeConfigFromValue(bad)).toEqual(NATIVE_OFF);
  });

  it('saves it in the kept collection, where a sync sends it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'native-'));
    copyFileSync(FIXTURE, join(dir, 'collection.anki2'));
    const db = await nodeSyncDb(join(dir, 'collection.anki2'));
    await setAnkiNativeRecordings(db, { on: true, languages: { th: true } }, NOW);
    const row = await db.first<{ val: Uint8Array; usn: number }>('SELECT val, usn FROM config WHERE KEY = ?', NATIVE_RECORDINGS_KEY);
    expect(nativeConfigFromValue(row!.val)).toEqual({ on: true, languages: { th: true } });
    expect(row!.usn).toBe(-1);
  });
});
