import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanField, decodeEntities, sortFieldAndChecksum } from '../../../src/anki/sync/noteFields';

/** sync-fixtures.json holds fields beside the sfld and csum Anki computed (make-sync-fixtures.py). */
const fixtures = JSON.parse(readFileSync(join(__dirname, '..', '..', 'fixtures', 'anki', 'sync-fixtures.json'), 'utf8')) as {
  notes: { fields: string[]; sfld: string | number; csum: number }[];
};

describe('a synced note\'s sort field and checksum', () => {
  it.each(fixtures.notes.map((n) => [n.fields[0], n] as const))('match what Anki stores for %j', (_front, n) => {
    const got = sortFieldAndChecksum(n.fields, 0);
    // SQLite stores a numeric sort field as a number (the column is declared integer).
    expect(got.sfld).toBe(String(n.sfld));
    expect(got.csum).toBe(n.csum);
  });

  it('uses the note type\'s sort field for sfld, and always the first field for csum', () => {
    const first = sortFieldAndChecksum(['<b>front</b>', 'back'], 0);
    const second = sortFieldAndChecksum(['<b>front</b>', 'back'], 1);
    expect(second.sfld).toBe('back');
    expect(second.csum).toBe(first.csum);
  });

  it('decodes entities only when every "&" starts one it knows', () => {
    expect(decodeEntities('caf&eacute; &lt;3')).toBe('café <3');
    expect(decodeEntities('a&nbsp;b')).toBe('a b');
    expect(decodeEntities('Tom & Jerry &amp; co')).toBe('Tom & Jerry &amp; co');
    expect(decodeEntities('&bogus; &amp;')).toBe('&bogus; &amp;');
  });

  it('drops control characters from a field, keeping newlines and tabs', () => {
    expect(cleanField('a\u0001b\nc\td\u007f')).toBe('ab\nc\td');
  });
});
