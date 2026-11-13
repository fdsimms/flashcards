import { describe, expect, it } from 'vitest';
import { omnilanguageFieldNames } from '../../src/import/models';
import { deckFromColumn, guessSeparator, importTsv, parseDelimited } from '../../src/import/tsv';
import type { NoteType } from '../../src/core/types';
import { NOW } from '../support/fixtures';

describe('TSV import', () => {
  it('parses quoted multi-line fields', () => {
    expect(parseDelimited('a\t"b\nc"\td\n', '\t')).toEqual([['a', 'b\nc', 'd']]);
  });
  it('imports an Omnilanguage TSV with metadata headers and tags column', () => {
    const row = omnilanguageFieldNames.map((n) => ({ Entry: 'Haus', Meaning: 'house', GenerateReverse: 'y', Language: 'German' } as Record<string, string>)[n] ?? '');
    const text = ['#separator:tab', '#html:true', '#notetype:Omnilanguage', '#deck:👅 Languages::🥨 Deutsch', `#tags column:${omnilanguageFieldNames.length + 1}`, [...row, 'noun a1'].join('\t')].join('\n');
    const res = importTsv(text, { now: NOW });
    expect(res.notes).toHaveLength(1);
    expect(res.notes[0].fields.Entry).toBe('Haus');
    expect(res.notes[0].tags).toEqual(['noun', 'a1']);
    expect(res.notes[0].deck).toBe('👅 Languages::🥨 Deutsch');
    expect(res.cards.map((c) => c.kind)).toEqual(['forward', 'reverse']);
  });
  it('uses #columns when present and skips blank rows', () => {
    const text = '#separator:tab\n#columns:Front\tBack\tTags\n#tags column:3\n#deck:Trivia\nQ1\tA1\tgeo\n\n';
    const res = importTsv(text);
    expect(res.notes).toHaveLength(1);
    expect(res.notes[0].fields).toEqual({ Front: 'Q1', Back: 'A1' });
    expect(res.notes[0].tags).toEqual(['geo']);
  });
  it('derives the same note id on every import, so a re-import updates rather than duplicates', () => {
    const text = '#separator:tab\n#columns:Front\tBack\n#deck:Trivia\nQ1\tA1\n';
    expect(importTsv(text).notes[0].id).toBe(importTsv(text).notes[0].id);
  });

  const basic: NoteType = { name: 'Basic', kind: 'normal', fields: ['Front', 'Back'], css: '', templates: [{ ord: 0, name: 'Card 1', front: '{{Front}}', back: '{{Back}}' }] };
  const clozeType: NoteType = { name: 'Cloze', kind: 'cloze', fields: ['Text', 'Back Extra'], css: '', templates: [{ ord: 0, name: 'Cloze', front: '{{cloze:Text}}', back: '{{cloze:Text}}' }] };
  const noteTypes = new Map([['Basic', basic], ['Cloze', clozeType]]);

  // Exactly what Anki 26.09.4's "Notes in Plain Text" export writes with every column on.
  const ankiExport = '#separator:tab\n#html:true\n#guid column:1\n#notetype column:2\n#deck column:3\n#tags column:6\n'
    + '"JZ!^z#u=To"\tBasic\tTrivia::Geo\tParis\tFrance\teu geo\nz:7;@H|7-2\tCloze\tTrivia::Geo\t{{c1::Paris {{c2::France}}}}\t\t\n';

  it("reads Anki's own export: fields past the metadata columns, each row's note type and deck", () => {
    const res = importTsv(ankiExport, { noteTypes, now: NOW });
    expect(res.warnings).toEqual([]);
    expect(res.notes).toEqual([
      { id: 'JZ!^z#u=To', deck: 'Trivia::Geo', model: 'Basic', fields: { Front: 'Paris', Back: 'France' }, tags: ['eu', 'geo'] },
      { id: 'z:7;@H|7-2', deck: 'Trivia::Geo', model: 'Cloze', fields: { Text: '{{c1::Paris {{c2::France}}}}', 'Back Extra': '' }, tags: [] },
    ]);
    expect(res.cards.map((c) => c.id)).toEqual(['JZ!^z#u=To:t0', 'z:7;@H|7-2:t0', 'z:7;@H|7-2:t1']);
  });

  it("skips a row whose note type isn't known here, and says so", () => {
    const res = importTsv(ankiExport, { noteTypes: new Map([['Basic', basic]]), now: NOW });
    expect(res.notes.map((n) => n.model)).toEqual(['Basic']);
    expect(res.warnings).toEqual([`Row 2: note type "Cloze" isn't in Franki yet, so the row was skipped. Import your collection from AnkiMobile first, then import this file again.`]);
  });

  it("accepts Anki's separator names in any case, and the characters themselves", () => {
    for (const [value, sep] of [['Comma', ','], ['COMMA', ','], [',', ','], ['Pipe', '|'], ['|', '|'], ['semicolon', ';'], ['Colon', ':'], [':', ':'], ['Space', ' '], [' ', ' '], ['Tab', '\t'], ['\t', '\t'], ['Tab\t\t', '\t']]) {
      const res = importTsv(`#separator:${value}\n#notetype:Basic\nQ1${sep}A1\n`, { noteTypes, now: NOW });
      expect([value, res.notes[0]?.fields]).toEqual([value, { Front: 'Q1', Back: 'A1' }]);
    }
    const unknown = importTsv('#separator:foo\n#notetype:Basic\nQ1\tA1\n', { noteTypes, now: NOW });
    expect(unknown.notes[0].fields).toEqual({ Front: 'Q1', Back: 'A1' });
    expect(unknown.warnings[0]).toMatch(/^The file's separator "foo" isn't one Anki writes, so it was guessed from the text\./);
  });

  it('guesses the separator as Anki does when the file names none: the first of its delimiters found', () => {
    const basic = (body: string) => importTsv(`#notetype:Basic\n${body}`, { noteTypes, now: NOW }).notes.map((n) => n.fields);
    expect(basic('Q1;A1\nQ2,x;A2\n')).toEqual([{ Front: 'Q1', Back: 'A1' }, { Front: 'Q2,x', Back: 'A2' }]);
    expect(basic('Hello there,Hi\n')).toEqual([{ Front: 'Hello there', Back: 'Hi' }]); // comma before space
    expect(basic('Q1\tA, B\n')).toEqual([{ Front: 'Q1', Back: 'A, B' }]);
    // Only the first 8 KB is looked at.
    expect(guessSeparator(`${'a'.repeat(9000)}\nx;y`)).toBe(' ');
  });

  it('escapes a file that says it isn\'t HTML, and takes one with no #html line as HTML only when it holds a tag', () => {
    const front = (text: string) => importTsv(`#separator:Comma\n#notetype:Basic\n${text}`, { noteTypes, now: NOW }).notes[0].fields.Front;
    expect(front('#html:false\na <b>x</b> & "y",A\n')).toBe('a &lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;');
    expect(front('#html:true\na <b>x</b> & y,A\n')).toBe('a <b>x</b> & y');
    expect(front('a <b>x</b> & y,A\n')).toBe('a <b>x</b> & y');
    expect(front('x < y & z,A\n')).toBe('x &lt; y &amp; z');
    expect(front('#html:false\n"l1\nl2",A\n')).toBe('l1<br>l2');
  });

  it('puts the file\'s #tags on every note, with any in its tags column', () => {
    const res = importTsv('#separator:Comma\n#notetype:Basic\n#tags:polish verbs\n#tags column:3\nQ1,A1,irregular\nQ2,A2,\n', { noteTypes, now: NOW });
    expect(res.notes.map((n) => n.tags)).toEqual([['polish', 'verbs', 'irregular'], ['polish', 'verbs']]);
  });

  it('keeps both rows that share a first field, the later under a derived suffix, and says so', () => {
    const text = '#separator:Comma\n#notetype:Basic\n#deck:Deutsch\nBank,bench\nBank,bank\nBank,riverbank\n';
    const res = importTsv(text, { noteTypes, now: NOW });
    expect(res.notes.map((n) => [n.id, n.fields.Back])).toEqual([['tsv:Deutsch:Bank', 'bench'], ['tsv:Deutsch:Bank (2)', 'bank'], ['tsv:Deutsch:Bank (3)', 'riverbank']]);
    expect(res.warnings).toEqual([
      'Row 2: "Bank" is also the first field of row 1, so both were imported as separate notes. Keep the rows in this order: if either moves, importing the file again can mix up their progress.',
      'Row 3: "Bank" is also the first field of row 1, so both were imported as separate notes. Keep the rows in this order: if either moves, importing the file again can mix up their progress.',
    ]);
    expect(importTsv(text, { noteTypes, now: NOW }).notes.map((n) => n.id)).toEqual(res.notes.map((n) => n.id));
  });

  it('warns about a row that makes no cards', () => {
    const res = importTsv('#separator:tab\n#notetype:Cloze\nno clozes here\t\n', { noteTypes, now: NOW });
    expect(res.cards).toEqual([]);
    expect(res.warnings).toEqual([`Row 1: "no clozes here" makes no cards: every card type's front would be blank. Fill in the field its front shows.`]);
  });

  it("reads a number in the deck column as a deck's id, as Anki does, and skips a row whose deck it can't find", () => {
    const decks = [{ id: 1794536001046, name: 'Polski::Odmiana' }, { name: '12345' }];
    expect(deckFromColumn('1794536001046', decks)).toBe('Polski::Odmiana');
    expect(deckFromColumn('12345', decks)).toBe('12345'); // not an id, but a deck's name
    expect(deckFromColumn('999', decks)).toBeNull();
    expect(deckFromColumn('Brand New', decks)).toBe('Brand New');
    const res = importTsv('#separator:Comma\n#notetype:Basic\n#deck column:3\nQ1,A1,1794536001046\nQ2,A2,999\n', { noteTypes, now: NOW, decks });
    expect(res.notes.map((n) => n.deck)).toEqual(['Polski::Odmiana']);
    expect(res.warnings).toEqual([expect.stringMatching(/^Row 2: there's no deck with the id 999/)]);
  });
});
