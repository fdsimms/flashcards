import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseJson } from '../../src/anki/sync/json';
import { cardRequirements, drawnByFranki, notesGainingCards, noteTypeSummary, templateProblems } from '../../src/core/noteTypeEdits';
import type { Note, NoteType } from '../../src/core/types';

const fixtures = join(__dirname, '..', 'fixtures', 'anki');
/** Note types Anki edited (make-notetype-vectors.py), and the ones sync sent (make-sync-fixtures.py), each with the requirements Anki worked out. */
const edited = JSON.parse(readFileSync(join(fixtures, 'notetype-vectors.json'), 'utf8')) as { cases: (NoteType & { note_type: string; req: [number, string, number[]][] })[] };
const synced = parseJson(readFileSync(join(fixtures, 'sync-fixtures.json'), 'utf8')) as unknown as {
  notetypes: { json: { name: string; type: number; flds: { name: string }[]; tmpls: { ord: number; name: string; qfmt: string; afmt: string }[]; css: string; req: [number, string, number[]][] } }[];
};

const BASIC: NoteType = {
  name: 'Basic (and reversed card)', kind: 'normal', fields: ['Front', 'Back'], css: '',
  templates: [
    { ord: 0, name: 'Card 1', front: '{{Front}}', back: '{{FrontSide}}<hr id=answer>{{Back}}' },
    { ord: 1, name: 'Card 2', front: '{{Back}}', back: '{{FrontSide}}<hr id=answer>{{Front}}' },
  ],
};
const CLOZE: NoteType = { name: 'Cloze', kind: 'cloze', fields: ['Text', 'Back Extra'], css: '', templates: [{ ord: 0, name: 'Cloze', front: '{{cloze:Text}}', back: '{{cloze:Text}}<br>{{Back Extra}}' }] };
const withTemplate = (nt: NoteType, ord: number, change: { front?: string; back?: string }): NoteType =>
  ({ ...nt, templates: nt.templates.map((t) => (t.ord === ord ? { ...t, ...change } : t)) });
const reqsAsAnki = (nt: NoteType) => cardRequirements(nt).map((r) => [r.ord, r.kind, r.fieldOrds]);

describe('the card requirements Anki works out from the fronts', () => {
  it.each(edited.cases.map((c) => [c.note_type, c] as const))('%s, after an edit: what Anki stored', (_name, c) => {
    expect(reqsAsAnki(c)).toEqual(c.req);
  });

  it.each(synced.notetypes.map((n) => [n.json.name, n.json] as const))('%s: what Anki stored', (_name, j) => {
    const nt: NoteType = { name: j.name, kind: j.type === 1 ? 'cloze' : 'normal', fields: j.flds.map((f) => f.name), css: j.css, templates: j.tmpls.map((t) => ({ ord: t.ord, name: t.name, front: t.qfmt, back: t.afmt })) };
    expect(reqsAsAnki(nt)).toEqual(j.req);
  });

  it('is none for a front Anki cannot parse', () => {
    expect(reqsAsAnki(withTemplate(BASIC, 0, { front: '{{#Front}}' }))[0]).toEqual([0, 'none', []]);
  });
});

describe('what Anki refuses in a template', () => {
  const problems = (nt: NoteType) => templateProblems(nt).map((p) => [p.ord, p.side, p.message]);

  it('takes the stock note types as they are, and the edits Anki takes', () => {
    expect(problems(BASIC)).toEqual([]);
    expect(problems(CLOZE)).toEqual([]);
    for (const front of ['{{Front}}{{FrontSide}}', '{{Tags}}', '{{#Front}}x{{/Front}}', '{{^Front}}x{{/Front}}', '{{tts en_US voices=Apple:Front}}', '{{foo:Front}}', '{{Front}}{{}}', ' {{Back}}']) {
      expect(problems(withTemplate(BASIC, 1, { front }))).toEqual([]);
    }
    expect(problems(withTemplate(BASIC, 0, { back: '' }))).toEqual([]);
    expect(problems(withTemplate(CLOZE, 0, { front: '{{type:cloze:Text}}', back: '{{type:cloze:Text}}' }))).toEqual([]);
  });

  it('refuses a field the note type does not have, on either side or in a section, by its exact name', () => {
    expect(problems(withTemplate(BASIC, 1, { front: '{{Bak}}' }))).toEqual([[1, 'front', "Card 2's front uses a field called Bak. This note type has no such field."]]);
    expect(problems(withTemplate(BASIC, 0, { back: '{{#Nope}}x{{/Nope}}' }))).toEqual([[0, 'back', "Card 1's back uses a field called Nope. This note type has no such field."]]);
    expect(problems(withTemplate(BASIC, 0, { front: '{{front}}' }))[0][2]).toContain('called front');
  });

  it('refuses a template it cannot read, a front with no field, and two card types with the same front', () => {
    expect(problems(withTemplate(BASIC, 0, { front: '{{#Front}}x' }))[0][2]).toBe("Card 1's front can't be read. Each {{#Field}} or {{^Field}} needs a {{/Field}} after it, with the same name.");
    expect(problems(withTemplate(BASIC, 0, { back: '{{Front}}{{/Back}}' }))[0][1]).toBe('back');
    expect(problems(withTemplate(BASIC, 0, { front: 'hello' }))).toEqual([[0, 'front', "Card 1's front shows no field. Add one, e.g. {{Front}}."]]);
    expect(problems(withTemplate(BASIC, 0, { front: '' }))[0][2]).toContain('shows no field');
    expect(problems(withTemplate(BASIC, 1, { front: '{{Front}}' }))).toEqual([[1, 'front', "Card 2's front is the same as Card 1's. Each card type needs a different front."]]);
  });

  it("refuses a cloze note type's side with no {{cloze:Field}}", () => {
    expect(problems(withTemplate(CLOZE, 0, { front: '{{Text}}' }))).toEqual([[0, 'front', "Cloze's front needs a cloze field, e.g. {{cloze:Text}}."]]);
    expect(problems(withTemplate(CLOZE, 0, { back: '{{cloze-only:Text}}' }))[0][1]).toBe('back');
    expect(problems(withTemplate(CLOZE, 0, { front: '{{cloze:Nope}}' }))[0][2]).toContain('called Nope');
  });
});

describe('notes that would gain a card', () => {
  const note = (id: string, fields: Record<string, string>, model = BASIC.name): Note => ({ id, deck: 'D', model, fields, tags: [] });
  const notes = [note('1', { Front: 'a', Back: 'b' }), note('2', { Front: 'a', Back: '' }), note('3', { Front: 'x', Back: '' }, 'Other')];
  const ords: Record<string, number[]> = { 1: [0, 1], 2: [0], 3: [0] };
  const ordsOf = (n: Note) => new Set(ords[n.id]);

  it('counts the notes of the type the new templates would give a card they have none for', () => {
    expect(notesGainingCards(notes, BASIC, ordsOf)).toBe(0);
    expect(notesGainingCards(notes, withTemplate(BASIC, 1, { front: '{{Back}}{{Front}}' }), ordsOf)).toBe(1);
    // A card the note no longer makes isn't a gain: Anki keeps it.
    expect(notesGainingCards(notes, withTemplate(BASIC, 1, { front: '{{Back}}x' }), ordsOf)).toBe(0);
  });
});

describe("a note type's line on the list", () => {
  it('counts notes and card types, and calls a cloze note type that', () => {
    expect(noteTypeSummary(BASIC, 1)).toBe('1 note. 2 card types');
    expect(noteTypeSummary({ ...BASIC, templates: BASIC.templates.slice(0, 1) }, 4108)).toBe('4,108 notes. 1 card type');
    expect(noteTypeSummary(CLOZE, 0)).toBe('0 notes. Cloze');
  });

  it('knows the note type Franki draws itself, by the same rule as a note', () => {
    expect(drawnByFranki({ ...BASIC, fields: ['Entry', 'Meaning', 'Audio'] })).toBe(true);
    expect(drawnByFranki(BASIC)).toBe(false);
  });
});
