import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseJson } from '../../../src/anki/sync/json';
import { notetypeRows, type NotetypeJson } from '../../../src/anki/sync/notetypeRows';
import { comparable } from '../../support/protoCompare';

/** Note types as sync sends them beside the rows Anki stored (make-sync-fixtures.py). */
const fixtures = parseJson(readFileSync(join(__dirname, '..', '..', 'fixtures', 'anki', 'sync-fixtures.json'), 'utf8')) as unknown as {
  notetypes: { json: NotetypeJson; config: string; fields: [number, string, string][]; templates: [number, string, string][] }[];
};

describe('a note type from sync, as the rows Anki stores', () => {
  it('covers cloze, and one with every field and template setting moved off its default', () => {
    expect(fixtures.notetypes.some((n) => n.json.type === 1)).toBe(true);
    expect(fixtures.notetypes.some((n) => n.json.name === 'Everything set')).toBe(true);
  });

  it.each(fixtures.notetypes.map((n) => [n.json.name, n] as const))('%s: what Anki wrote', (_name, n) => {
    const rows = notetypeRows(n.json);
    expect(comparable(rows.config)).toEqual(comparable(n.config));
    expect(rows.fields.map((f) => [f.ord, f.name, comparable(f.config)])).toEqual(n.fields.map(([o, name, c]) => [o, name, comparable(c)]));
    expect(rows.templates.map((t) => [t.ord, t.name, comparable(t.config)])).toEqual(n.templates.map(([o, name, c]) => [o, name, comparable(c)]));
  });
});
