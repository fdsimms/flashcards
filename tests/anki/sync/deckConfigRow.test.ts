import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseJson } from '../../../src/anki/sync/json';
import { deckConfigJson, deckConfigRow, type DeckConfigJson } from '../../../src/anki/sync/deckConfigRow';
import { comparable } from '../../support/protoCompare';

/** Deck options as sync sends them beside the row Anki stored (make-sync-fixtures.py). */
const fixtures = parseJson(readFileSync(join(__dirname, '..', '..', 'fixtures', 'anki', 'sync-fixtures.json'), 'utf8')) as unknown as {
  deck_configs: { json: DeckConfigJson; config: string }[];
};

describe('deck options from sync, as the row Anki stores', () => {
  it('covers a preset with every option moved off its default', () => {
    expect(fixtures.deck_configs.some((c) => c.json.name === 'Everything set')).toBe(true);
  });

  it.each(fixtures.deck_configs.map((c) => [c.json.name, c] as const))('%s: what Anki wrote', (_name, c) => {
    const row = deckConfigRow(c.json);
    expect(comparable(row.config)).toEqual(comparable(c.config));
    expect(row).toMatchObject({ id: Number(c.json.id), name: c.json.name, usn: c.json.usn });
  });

  it('is byte for byte Anki\'s when no add-on keys are involved', () => {
    const plain = fixtures.deck_configs.find((c) => c.json.name === 'Default')!;
    expect(Buffer.from(deckConfigRow(plain.json).config).toString('base64')).toBe(plain.config);
  });

  // What sync sends for a preset changed on this phone: the row read back into the JSON Anki's own
  // client would send, so the server's copy keeps every other setting.
  it.each(fixtures.deck_configs.map((c) => [c.json.name, c] as const))('%s: row back to the JSON Anki sent', (_name, c) => {
    expect(deckConfigJson(deckConfigRow(c.json))).toEqual({ ...c.json, mod: Number(c.json.mod) });
  });

  it('reads the order back from a row with the option moved', () => {
    const everything = fixtures.deck_configs.find((c) => c.json.name === 'Everything set')!;
    expect(deckConfigJson(deckConfigRow(everything.json))).toMatchObject({ newMix: 1, interdayLearningMix: 2, reviewOrder: 7 });
  });
});
