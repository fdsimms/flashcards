import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeMessage, exportCollection, mediaReferences, readDeckConfig, readDeckKind, writeBundle } from '../../scripts/lib/ankiCollection.mjs';
import { importAnkiJson } from '../../src/import/ankiJson';
import { NOW } from '../support/fixtures';

/** A real collection written by Anki itself (tests/fixtures/anki/make-collection.py builds it). */
const FIXTURE = join(__dirname, '..', 'fixtures', 'anki', 'collection.anki2');
const THAI = '👅 Languages::🐘 ภาษาไทย';

const hex = (s: string) => Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));

describe('protobuf reading', () => {
  it('decodes varints, nested messages and packed floats', () => {
    // field 1 = varint 150; field 2 = packed floats [1.5, 2]
    const msg = decodeMessage(hex('089601' + '1208' + '0000c03f' + '00000040'));
    expect(msg.get(1)[0].value).toBe(150n);
    expect(readDeckConfig(hex('2a08' + '0000c03f' + '00000040' + '4805' + '5096' + '01')).weights).toEqual([1.5, 2]);
  });
  it('reads a deck kind blob Anki wrote', () => {
    // Trivia: preset 1, its own new-card limit of 3.
    expect(readDeckKind(hex('0A0408013803'))).toEqual({ configId: 1, newLimit: 3, reviewLimit: undefined, desiredRetention: undefined });
    expect(readDeckKind(hex('12260801'))).toBeUndefined(); // filtered
  });
});

describe('exportCollection', () => {
  it('reads a real Anki collection: notes, scheduling and deck settings', async () => {
    const data = await exportCollection(FIXTURE);
    expect(data.notes).toHaveLength(7);
    expect(data.notes[0]).toMatchObject({ modelName: 'Basic (and reversed card)', tags: ['a1', 'noun'], fields: { Front: 'หนังสือ', Back: 'book' } });

    expect(data.deckConfigs[THAI]).toMatchObject({ newPerDay: 1, reviewsPerDay: 150, desiredRetention: 0.85, maxInterval: 3650 });
    expect(data.deckConfigs[THAI].weights).toHaveLength(21);
    // The deck's own limit wins over its preset's.
    expect(data.deckConfigs['🧠 Trivia']).toMatchObject({ newPerDay: 3, reviewsPerDay: 200 });
    expect(data.deckConfigs['Filtered Deck 1']).toBeUndefined();

    const learning = data.cards.find((c) => c.queue === 1)!;
    expect(learning.due!).toBeGreaterThan(1_000_000_000);
    expect(learning.memoryState!.stability).toBeGreaterThan(0);
    expect(data.cards.filter((c) => c.queue === -1)).toHaveLength(1);
    // The card borrowed into the filtered deck is exported under its home deck, with its real due.
    expect(data.cards.filter((c) => c.deckName === 'Filtered Deck 1')).toHaveLength(0);
    const peru = data.notes.find((n) => n.fields.Front === 'Capital of Peru?')!;
    const peruCard = data.cards.find((c) => c.note === peru.noteId)!;
    expect(peruCard).toMatchObject({ deckName: '🧠 Trivia', type: 2, queue: 2 });
    expect(peruCard.due!).toBeGreaterThan(0);
  });

  it('round-trips into the importer with scheduling and settings intact', async () => {
    const res = importAnkiJson(await exportCollection(FIXTURE), { now: NOW });
    const crt = (await exportCollection(FIXTURE)).collectionCreated;
    const book = res.notes.find((n) => n.fields.Front === 'หนังสือ')!;
    const card = res.cards.find((c) => c.noteId === book.id)!;
    expect(card.sched.state).toBe(2);
    expect(new Date(card.sched.due).getTime()).toBeGreaterThan(crt * 1000);
    expect(res.deckParams!.get(THAI)).toMatchObject({ newPerDay: 1, reviewsPerDay: 150, desiredRetention: 0.85 });
    // Every Anki card arrives: both templates of the reversed note, both clozes of the cloze note.
    expect(res.warnings).toEqual([]);
    expect(res.cards.filter((c) => c.noteId === book.id).map((c) => c.kind)).toEqual(['t0', 't1']);
    const cloze = res.notes.find((n) => n.model === 'Cloze')!;
    expect(res.cards.filter((c) => c.noteId === cloze.id).map((c) => c.kind)).toEqual(['t0', 't1']);
  });

  it('exports each note type in use with its kind, fields, templates and CSS', async () => {
    const { noteTypes } = await exportCollection(FIXTURE);
    expect(noteTypes.map((t) => [t.name, t.kind, t.templates.length]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))).toEqual([
      ['Basic', 'normal', 1], ['Basic (and reversed card)', 'normal', 2], ['Cloze', 'cloze', 1],
    ]);
    const cloze = noteTypes.find((t) => t.name === 'Cloze')!;
    expect(cloze.fields).toEqual(['Text', 'Back Extra']);
    expect(cloze.templates[0].front).toContain('{{cloze:Text}}');
    expect(cloze.css).toContain('.card');
  });
});

describe('media', () => {
  it('takes the files notes and templates use, plus "_" files, and nothing else', async () => {
    const data = await exportCollection(FIXTURE);
    expect(mediaReferences(data, ['flag.svg', 'hello.mp3', 'unused.png', '_font.ttf'])).toEqual(['_font.ttf', 'flag.svg', 'hello.mp3']);
  });
  it('writes one bundle file with the export and its media', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const out = join(mkdtempSync(join(tmpdir(), 'bundle-')), 'anki-export.sqlite');
    const data = await exportCollection(FIXTURE);
    expect(await writeBundle(out, data, join(__dirname, '..', 'fixtures', 'anki', 'collection.media'))).toEqual({ media: 2 });
    const db = new DatabaseSync(out, { readOnly: true });
    const names = db.prepare('SELECT name FROM media ORDER BY name').all().map((r: any) => r.name);
    const json = JSON.parse(String((db.prepare('SELECT json FROM export').get() as any).json));
    db.close();
    expect(names).toEqual(['flag.svg', 'hello.mp3']);
    expect(json.notes).toHaveLength(7);
  });
});
