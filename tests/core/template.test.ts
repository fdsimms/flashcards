import { describe, expect, it } from 'vitest';
import { cardDocument, clozeNumbers, fieldIsEmpty, renderTemplate, renderTemplateCard, templateOrdinals } from '../../src/core/template';
import type { Note, NoteType } from '../../src/core/types';

const geo: NoteType = {
  name: 'Ultimate Geography', kind: 'normal', fields: ['Country', 'Capital info', 'Capital', 'Flag'], css: '.card { color: red; }',
  templates: [
    { ord: 0, name: 'Country - Capital', front: '{{#Capital}}{{Country}}{{/Capital}}', back: '{{FrontSide}}<hr id=answer>{{Capital}}{{#Capital info}}<br>{{Capital info}}{{/Capital info}}' },
    { ord: 1, name: 'Flag - Country', front: '{{#Flag}}{{Flag}}{{/Flag}}', back: '{{FrontSide}}<hr id=answer>{{Country}}' },
  ],
};
const peru: Note = {
  id: '1', deck: 'Trivia::Geo', model: 'Ultimate Geography', tags: ['americas'],
  fields: { Country: 'Peru', 'Capital info': '', Capital: 'Lima', Flag: '<img src="ug-flag-peru.svg" />' },
};
const cloze: NoteType = { name: 'Cloze', kind: 'cloze', fields: ['Text', 'Extra'], css: '', templates: [{ ord: 0, name: 'Cloze', front: '{{cloze:Text}}', back: '{{cloze:Text}}<br>{{Extra}}' }] };

describe('renderTemplate', () => {
  it('fills fields and shows a section only when its field has content', () => {
    const { front, back } = renderTemplateCard(peru, geo, 0);
    expect(front).toBe('Peru');
    expect(back).toBe('Peru<hr id=answer>Lima');
  });
  it('counts an image as content, and only whitespace, <br> and <div> as empty', () => {
    expect(fieldIsEmpty('<img src="x.png">')).toBe(false);
    expect(fieldIsEmpty(' <br> <div></div>&nbsp;')).toBe(true);
    expect(renderTemplateCard(peru, geo, 1).front).toBe('<img src="ug-flag-peru.svg" />');
  });
  it('inverts with ^, nests sections, and fills special fields', () => {
    const ctx = { note: peru, noteType: geo, ord: 1, side: 'front' as const };
    expect(renderTemplate('{{^Capital info}}none{{/Capital info}}', ctx)).toBe('none');
    expect(renderTemplate('{{#Country}}[{{#Capital}}{{Capital}}{{/Capital}}]{{/Country}}', ctx)).toBe('[Lima]');
    expect(renderTemplate('{{Card}} / {{Type}} / {{Subdeck}} / {{Tags}}', ctx)).toBe('Flag - Country / Ultimate Geography / Geo / americas');
  });
  it('applies filters: hint, text, type, furigana, tts', () => {
    const note: Note = { ...peru, fields: { ...peru.fields, Reading: '日本[にほん]', Html: '<b>bold</b>' } };
    const ctx = { note, noteType: geo, ord: 0, side: 'front' as const };
    expect(renderTemplate('{{hint:Capital}}', ctx)).toMatch(/>Capital<\/a><div class="hint" style="display:none">Lima<\/div>/);
    expect(renderTemplate('{{text:Html}}', ctx)).toBe('bold');
    expect(renderTemplate('{{type:Capital}}', ctx)).toBe('');
    expect(renderTemplate('{{type:Capital}}', { ...ctx, side: 'back' })).toBe('Lima');
    expect(renderTemplate('{{furigana:Reading}}', ctx)).toBe('<ruby><rb>日本</rb><rt>にほん</rt></ruby>');
    expect(renderTemplate('{{kana:Reading}}', ctx)).toBe('にほん');
    expect(renderTemplate('{{tts en_US:Capital}}', ctx)).toBe('');
  });
});

describe('cloze', () => {
  const note: Note = { id: 'c', deck: 'D', model: 'Cloze', tags: [], fields: { Text: '{{c1::Lima}} is the capital of {{c2::Peru::country}}', Extra: 'South America' } };
  it('hides the active cloze on the front and shows the others', () => {
    expect(renderTemplateCard(note, cloze, 1).front).toBe('<span class="cloze-inactive">Lima</span> is the capital of <span class="cloze">[country]</span>');
    expect(renderTemplateCard(note, cloze, 0).back).toContain('<span class="cloze">Lima</span>');
  });
  it('makes one card per cloze number', () => {
    expect(clozeNumbers(note.fields.Text)).toEqual([1, 2]);
    expect(templateOrdinals(note, cloze)).toEqual([0, 1]);
  });
});

describe('templateOrdinals', () => {
  it('skips a template whose front stays empty for this note', () => {
    expect(templateOrdinals(peru, geo)).toEqual([0, 1]);
    expect(templateOrdinals({ ...peru, fields: { ...peru.fields, Flag: '' } }, geo)).toEqual([0]);
  });
});

describe('cardDocument', () => {
  it('wraps the card with its CSS, Anki body classes and sound buttons', () => {
    const doc = cardDocument('Hi [sound:hello.mp3]', { css: '.card { color: red; }', ord: 1, dark: true, autoplay: true });
    expect(doc).toContain('<body class="card card2 nightMode night_mode">');
    expect(doc).toContain('.card { color: red; }');
    expect(doc).toContain('data-sound="hello.mp3"');
    expect(doc).toContain('playSound(first.dataset.sound)');
  });

  it("paints the page in the app's colors when given them", () => {
    const doc = cardDocument('Hi', { css: '', ord: 0, dark: true, autoplay: false, colors: { background: '#123456', text: '#abcdef', cloze: '#fedcba' } });
    expect(doc).toContain('background: #123456; color: #abcdef;');
    expect(doc).toContain('.cloze { font-weight: bold; color: #fedcba; }');
  });
});
