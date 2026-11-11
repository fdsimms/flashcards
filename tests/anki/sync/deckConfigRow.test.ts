import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseJson } from '../../../src/anki/sync/json';
import { deckConfigRow, type DeckConfigJson } from '../../../src/anki/sync/deckConfigRow';
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
});
