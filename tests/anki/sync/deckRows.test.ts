import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deckCommon, deckKind, deckRow, nativeDeckName } from '../../../src/anki/sync/deckRows';
import type { DeckJson } from '../../../src/anki/sync/protocol';
import { decodeMessage, int, MessageWriter } from '../../../src/anki/protobuf';

/** Each deck's JSON (as sync sends it) beside the blobs Anki stored for it (make-sync-fixtures.py). */
const fixtures = JSON.parse(readFileSync(join(__dirname, '..', '..', 'fixtures', 'anki', 'sync-fixtures.json'), 'utf8')) as {
  decks: { json: DeckJson; common: string; kind: string }[];
};
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');

describe('a deck from sync, as the row Anki stores', () => {
  it('covers a filtered deck and a normal deck with every option set', () => {
    expect(fixtures.decks.some((d) => d.json.dyn)).toBe(true);
    expect(fixtures.decks.some((d) => d.json.desc && d.json.reviewLimitToday && d.json.desiredRetention)).toBe(true);
  });

  it.each(fixtures.decks.map((d) => [d.json.name, d] as const))('%s: byte for byte what Anki wrote', (_name, d) => {
    expect(b64(deckCommon(d.json))).toBe(d.common);
    expect(b64(deckKind(d.json))).toBe(d.kind);
  });

  it('zeroes a count from an earlier day than the latest one', () => {
    const json = { ...fixtures.decks[0].json, newToday: [10, 4], revToday: [12, 7], lrnToday: [10, 2], timeToday: [12, 900] };
    const common = decodeMessage(deckCommon(json as DeckJson));
    expect(int(common, 3)).toBe(12);
    expect(int(common, 4)).toBeUndefined(); // new studied: day 10, stale
    expect(int(common, 5)).toBe(7);
  });

  it('keeps a negative count (extending a limit in Anki can make one)', () => {
    const json = { ...fixtures.decks[0].json, newToday: [5, -3], timeToday: [5, 0] };
    expect(int(decodeMessage(deckCommon(json as DeckJson)), 4)).toBe(-3);
    expect(int(decodeMessage(new MessageWriter().uint(1, -1).finish()), 1)).toBe(-1);
  });

  it('stores the name with \\x1f between levels', () => {
    expect(nativeDeckName('Polski::Odmiana')).toBe('Polski\x1fOdmiana');
    expect(deckRow({ id: '5', name: 'A::B', mod: '9', usn: 3, dyn: 0, conf: 1 })).toMatchObject({ id: 5, name: 'A\x1fB', mtime: 9, usn: 3 });
  });
});
