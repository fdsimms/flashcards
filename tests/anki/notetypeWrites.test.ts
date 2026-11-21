import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { setAnkiNoteTypeLook } from '../../src/anki/notetypeWrites';
import { cardRequirements } from '../../src/core/noteTypeEdits';
import type { NoteType } from '../../src/core/types';
import { comparable } from '../support/protoCompare';
import { nodeSyncDb } from '../support/syncDb';

const FIXTURE = join(__dirname, '..', 'fixtures', 'anki', 'collection.anki2');
const NOW = new Date(2026, 10, 11, 12);

/** Note types Anki itself edited (make-notetype-vectors.py). */
const vectors = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'anki', 'notetype-vectors.json'), 'utf8')) as {
  cases: (NoteType & { note_type: string; config: string; usn: number; template_configs: [number, string, number, number][] })[];
};

async function kept(opts: { unicase?: boolean } = { unicase: true }) {
  const dir = mkdtempSync(join(tmpdir(), 'notetype-'));
  copyFileSync(FIXTURE, join(dir, 'collection.anki2'));
  const db = await nodeSyncDb(join(dir, 'collection.anki2'), opts);
  await db.run('UPDATE notetypes SET usn = 0');
  return db;
}

const asNoteType = (c: (typeof vectors.cases)[number]): NoteType => ({ name: c.note_type, kind: c.kind, fields: c.fields, css: c.css, templates: c.templates });
const lookOf = (nt: NoteType) => ({ templates: nt.templates, css: nt.css, reqs: cardRequirements(nt) });

describe("a note type's templates and styling in the kept collection", () => {
  it.each(vectors.cases.map((c) => [c.note_type, c] as const))('%s: the rows Anki wrote for the same change', async (name, c) => {
    const db = await kept();
    expect(await setAnkiNoteTypeLook(db, name, lookOf(asNoteType(c)), NOW)).toBe('saved');
    const nt = (await db.all<{ id: number; name: string; config: Uint8Array; mtime_secs: number; usn: number }>('SELECT id, name, config, mtime_secs, usn FROM notetypes NOT INDEXED')).find((r) => r.name === name)!;
    expect(comparable(nt.config)).toEqual(comparable(c.config));
    expect(nt).toMatchObject({ usn: -1, mtime_secs: Math.floor(NOW.getTime() / 1000) });
    const templates = await db.all<{ ord: number; config: Uint8Array; mtime_secs: number; usn: number }>('SELECT ord, config, mtime_secs, usn FROM templates WHERE ntid = ? ORDER BY ord', nt.id);
    expect(templates.map((t) => [t.ord, comparable(t.config), t.mtime_secs, t.usn])).toEqual(c.template_configs.map(([ord, config, mtime, usn]) => [ord, comparable(config), mtime, usn]));
    expect((await db.first<{ mod: number }>('SELECT mod FROM col'))!.mod).toBe(NOW.getTime());
    db.close();
  });

  it('is byte for byte what Anki wrote when the note type has no add-on keys', async () => {
    const db = await kept();
    const c = vectors.cases[0];
    await setAnkiNoteTypeLook(db, c.note_type, lookOf(asNoteType(c)), NOW);
    const nt = (await db.all<{ name: string; config: Uint8Array }>('SELECT name, config FROM notetypes NOT INDEXED')).find((r) => r.name === c.note_type)!;
    expect(Buffer.from(nt.config).toString('base64')).toBe(c.config);
    db.close();
  });

  it('refuses a note type the collection does not have, and one whose card types changed in Anki', async () => {
    const db = await kept();
    const c = asNoteType(vectors.cases[0]);
    expect(await setAnkiNoteTypeLook(db, 'Nope', lookOf(c), NOW)).toBe('missing');
    expect(await setAnkiNoteTypeLook(db, c.name, lookOf({ ...c, templates: c.templates.slice(0, 1) }), NOW)).toBe('changed');
    expect((await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM notetypes WHERE usn = -1'))!.n).toBe(0);
    db.close();
  });

  it("refuses on a build without Anki's collation, which couldn't sync the change without a full upload", async () => {
    const db = await kept({ unicase: false });
    const c = asNoteType(vectors.cases[0]);
    expect(await setAnkiNoteTypeLook(db, c.name, lookOf(c), NOW)).toBe('noCollation');
    db.close();
  });
});
