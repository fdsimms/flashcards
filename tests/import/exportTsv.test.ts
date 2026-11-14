import { describe, expect, it } from 'vitest';
import type { Note, NoteType } from '../../src/core/types';
import { exportTsv } from '../../src/import/exportTsv';
import { importTsv } from '../../src/import/tsv';

const basic: NoteType = { name: 'Basic', kind: 'normal', fields: ['Front', 'Back'], css: '', templates: [{ ord: 0, name: 'Card 1', front: '{{Front}}', back: '{{Back}}' }] };
const types = new Map([[basic.name, basic]]);
const note = (id: string, fields: Record<string, string>, over: Partial<Note> = {}): Note => ({ id, deck: 'Trivia', model: 'Basic', fields, tags: [], ...over });

describe('exporting notes as text', () => {
  it('writes the header lines and one row per note, fields in the note type\'s order', () => {
    const [file] = exportTsv([note('100', { Back: 'Warsaw', Front: 'Capital of Poland?' }, { tags: ['geo', 'europe'] })], types, 'Trivia');
    expect(file.text.split('\n')).toEqual([
      '#separator:tab', '#html:true', '#guid column:1', '#notetype:Basic', '#deck column:2', '#tags column:5',
      '#columns:GUID\tDeck\tFront\tBack\tTags',
      '100\tTrivia\tCapital of Poland?\tWarsaw\tgeo europe',
      '',
    ]);
    expect(file.name).toBe('Trivia.txt');
  });

  it('makes one file per note type, named for it', () => {
    const files = exportTsv([note('1', { Front: 'a', Back: 'b' }), note('2', { Entry: 'kot' }, { model: 'Omnilanguage' })], types, 'Polski');
    expect(files.map((f) => f.name)).toEqual(['Polski - Basic.txt', 'Polski - Omnilanguage.txt']);
    expect(files.map((f) => f.notes)).toEqual([1, 1]);
  });

  it('keeps fields a note has that the note type doesn\'t list, after the listed ones', () => {
    const [file] = exportTsv([note('1', { Front: 'a', Back: 'b', Extra: 'x' })], types, 'T');
    expect(file.text).toContain('#columns:GUID\tDeck\tFront\tBack\tExtra\tTags');
  });

  it('strips characters a file name can\'t hold', () => {
    expect(exportTsv([note('1', { Front: 'a', Back: 'b' })], types, 'A/B: C')[0].name).toBe('A-B- C.txt');
  });

  it('reads back through the importer as the same notes', () => {
    const original = [
      note('anki-1', { Front: 'Tab\there', Back: 'line one\nline "two"' }, { deck: 'Trivia::Geo', tags: ['a', 'b'] }),
      note('anki-2', { Front: '#hash', Back: '<b>bold</b> & more' }),
      note('anki-3', { Front: 'empty back', Back: '' }),
    ];
    const [file] = exportTsv(original, types, 'Trivia');
    const back = importTsv(file.text, { noteTypes: types });
    expect(back.warnings).toEqual([]);
    expect(back.notes).toEqual(original);
  });

  it('reads Omnilanguage back by its column names', () => {
    const o: Note = { id: 'o1', deck: 'Polski', model: 'Omnilanguage', fields: { Entry: 'kot', Meaning: 'cat', Context: 'To jest <b>kot</b>.' }, tags: ['animal'] };
    const [file] = exportTsv([o], new Map(), 'Polski');
    const back = importTsv(file.text);
    expect(back.notes[0]).toMatchObject({ id: 'o1', deck: 'Polski', model: 'Omnilanguage', tags: ['animal'] });
    expect(back.notes[0].fields).toMatchObject({ Entry: 'kot', Meaning: 'cat', Context: 'To jest <b>kot</b>.' });
  });
});
