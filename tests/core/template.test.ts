import { describe, expect, it } from 'vitest';
import { cardDocument, fieldIsEmpty, renderTemplate, renderTemplateCard, sideAudio, templateOrdinals } from '../../src/core/template';
import type { Note, NoteType } from '../../src/core/types';
import vectors from '../fixtures/anki/template-vectors.json';

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
  it('counts an image and a no-break space as content, and only ASCII whitespace, <br> and <div> as empty', () => {
    expect(fieldIsEmpty('<img src="x.png">')).toBe(false);
    expect(fieldIsEmpty(' <br> <div></div>\n')).toBe(true);
    expect(fieldIsEmpty('&nbsp;')).toBe(false);
    expect(fieldIsEmpty(' ')).toBe(false);
    expect(renderTemplateCard(peru, geo, 1).front).toBe('<img src="ug-flag-peru.svg" />');
  });

  /** Recorded from the real `anki` 26.09.4 package (tests/fixtures/anki/make-template-vectors.py). */
  it.each(vectors.conditionals)('shows {{#Field}} for $value as Anki does', ({ value, front }) => {
    const nt: NoteType = { name: 'Conditional', kind: 'normal', fields: ['A', 'B'], css: '', templates: [{ ord: 0, name: 'T', front: '{{A}}|{{#B}}has B{{/B}}{{^B}}no B{{/B}}', back: 'x' }] };
    const note: Note = { id: 'n', deck: 'D', model: 'Conditional', tags: [], fields: { A: 'a', B: value } };
    expect(renderTemplateCard(note, nt, 0).front).toBe(front);
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
    // As rslib: a placeholder for the reviewer's pass (renderTemplateCard).
    expect(renderTemplate('{{type:Capital}}', ctx)).toBe('[[type:Capital]]');
    expect(renderTemplate('{{type:cloze:Capital}} {{type:nc:Capital}} {{type:text:Capital}}', ctx)).toBe('[[type:cloze:Capital]] [[type:nc:Capital]] [[type:Capital]]');
    expect(renderTemplate('{{furigana:Reading}}', ctx)).toBe('<ruby><rb>日本</rb><rt>にほん</rt></ruby>');
    expect(renderTemplate('{{kana:Reading}}', ctx)).toBe('にほん');
    expect(renderTemplate('{{tts en_US speed=0.8:Capital}}', ctx)).toBe('[anki:tts lang=en_US speed=0.8]Lima[/anki:tts]');
  });
});

describe('type the answer', () => {
  const typed = (front: string, back: string): NoteType => ({ ...geo, templates: [{ ord: 0, name: 'Typed', front, back }] });

  it('asks for the field under the card, and compares on the back where {{type:}} sits', () => {
    const nt = typed('{{Country}}<br>{{type:Capital}}', '{{Country}}<hr id=answer>{{type:Capital}}');
    const { front, back, typeAnswer } = renderTemplateCard(peru, nt, 0, 'Lma');
    expect(front).toBe('Peru<br>');
    expect(typeAnswer).toEqual({ expected: 'Lima', combining: true });
    expect(back).toBe('Peru<hr id=answer><div><code id=typeans><span class=typeGood>L</span><span class=typeMissed>-</span><span class=typeGood>ma</span><br><span id=typearrow>&darr;</span><br><span class=typeGood>L</span><span class=typeMissed>i</span><span class=typeGood>ma</span></code></div>');
  });

  it("shows the comparison where FrontSide's [[type:]] is, with the line moved above it, as Anki does", () => {
    const nt = typed('{{Country}} {{type:Capital}}', '{{FrontSide}}<hr id=answer>{{Capital}}');
    const { back } = renderTemplateCard(peru, nt, 0, 'Lima');
    expect(back).toBe('Peru <hr id=answer><div><code id=typeans><span class=typeGood>Lima</span></code></div>Lima');
  });

  it("shows the answer alone when nothing was typed, and asks nothing for an empty field", () => {
    const nt = typed('{{type:Capital}}', '{{type:Capital}}');
    expect(renderTemplateCard(peru, nt, 0).back).toBe('<div><code id=typeans>Lima</code></div>');
    const empty = renderTemplateCard({ ...peru, fields: { ...peru.fields, Capital: '' } }, nt, 0);
    expect([empty.front, empty.back, empty.typeAnswer]).toEqual(['', '', undefined]);
  });

  it("says when the field isn't in the note type", () => {
    const { front, typeAnswer } = renderTemplateCard(peru, typed('{{type:Nope}}', ''), 0);
    expect([front, typeAnswer]).toEqual(['Type answer: unknown field Nope', undefined]);
  });

  it("types a cloze's text, and ignores accents with nc", () => {
    const note: Note = { id: 'c', deck: 'D', model: 'Cloze', tags: [], fields: { Text: '{{c1::Łódź}} is in {{c2::Poland}}', Extra: '' } };
    const nt: NoteType = { ...cloze, templates: [{ ord: 0, name: 'Cloze', front: '{{cloze:Text}}{{type:cloze:Text}}', back: '{{type:cloze:Text}}' }] };
    expect(renderTemplateCard(note, nt, 0).typeAnswer).toEqual({ expected: 'Łódź', combining: true });
    expect(renderTemplateCard(note, nt, 1).typeAnswer).toEqual({ expected: 'Poland', combining: true });
    expect(renderTemplateCard(note, nt, 2).front).toContain("Type answer: cloze 3 isn't on this note.");
    const nc = typed('{{type:nc:Capital}}', '{{type:nc:Capital}}');
    const accented = { ...peru, fields: { ...peru.fields, Capital: 'Bogotá' } };
    expect(renderTemplateCard(accented, nc, 0, 'Bogota').back).toBe('<div><code id=typeans><span class=typeGood>Bogotá</span></code></div>');
  });
});

describe('reading aloud', () => {
  const spoken: NoteType = { ...geo, templates: [{ ord: 0, name: 'Spoken', front: '{{Country}}{{tts es_ES:Capital}}', back: '{{FrontSide}}<hr id=answer>{{tts es_ES:Country}}' }] };

  it('gives each side a play button per tag, and the back reads only its own', () => {
    const { front, back } = renderTemplateCard(peru, spoken, 0);
    expect(sideAudio(front)).toEqual({ tts: [{ text: 'Lima', lang: 'es_ES', voices: [], speed: 1 }], hasSound: false });
    expect(sideAudio(back).tts.map((t) => t.text)).toEqual(['Peru']);
    expect(cardDocument(front, { css: '', ord: 0, dark: false, autoplay: true })).toContain('onclick="speakTts(0);return false;"');
  });

  it("knows a side with a recording, which plays instead of being read", () => {
    expect(sideAudio('[sound:lima.mp3][anki:tts lang=es_ES]Lima[/anki:tts]').hasSound).toBe(true);
  });

  it('reads only the cloze with cloze-only, as Anki does', () => {
    const note: Note = { id: 'c', deck: 'D', model: 'Cloze', tags: [], fields: { Text: '{{c1::Lima}} and {{c1::Cusco::city}} are in {{c2::Peru}}', Extra: '' } };
    const nt: NoteType = { ...cloze, templates: [{ ord: 0, name: 'Cloze', front: '{{cloze:Text}}{{tts es_ES:cloze-only:Text}}', back: '{{tts es_ES:cloze-only:Text}}' }] };
    const card = renderTemplateCard(note, nt, 0);
    expect(sideAudio(card.front).tts[0].text).toBe('..., city');
    expect(sideAudio(card.back).tts[0].text).toBe('Lima, Cusco');
  });
});

describe('cloze', () => {
  const note: Note = { id: 'c', deck: 'D', model: 'Cloze', tags: [], fields: { Text: '{{c1::Lima}} is the capital of {{c2::Peru::country}}', Extra: 'South America' } };
  it('hides the active cloze on the front and shows the others', () => {
    expect(renderTemplateCard(note, cloze, 1).front).toBe('<span class="cloze-inactive" data-ordinal="1">Lima</span> is the capital of <span class="cloze" data-cloze="Peru" data-ordinal="2">[country]</span>');
    expect(renderTemplateCard(note, cloze, 0).back).toContain('<span class="cloze" data-ordinal="1">Lima</span>');
  });
  it('makes one card per cloze number', () => {
    expect(templateOrdinals(note, cloze)).toEqual([0, 1]);
  });
  it('makes a card for a cloze inside another, and for a cloze in any field', () => {
    expect(templateOrdinals({ ...note, fields: { Text: '{{c1::Paris {{c2::France}}}}', Extra: '' } }, cloze)).toEqual([0, 1]);
    expect(templateOrdinals({ ...note, fields: { Text: '{{c1::Lima}}', Extra: '{{c3::Peru}}' } }, cloze)).toEqual([0, 2]);
  });

  /** Recorded from the real `anki` 26.09.4 package (tests/fixtures/anki/make-template-vectors.py). */
  it.each(vectors.cloze)('makes the cards Anki makes for $text', ({ text, extra, cards }) => {
    const probe: NoteType = { ...cloze, fields: ['Text', 'Back Extra'] };
    const generated = templateOrdinals({ ...note, fields: { Text: text, 'Back Extra': extra } }, probe);
    // A note with no cloze gets card 1 from Anki, only to show an error on; Franki makes none.
    expect(generated).toEqual(Object.entries(cards).filter(([, c]) => !('empty' in c)).map(([ord]) => Number(ord)));
  });

  /** Recorded from the real `anki` 26.09.4 package, with its stock Image Occlusion note type. */
  it.each(vectors.imageOcclusion.notes)('renders an image occlusion note as Anki does (%#)', ({ fields, cards }) => {
    const { name, fields: names, css, front, back } = vectors.imageOcclusion.noteType;
    const io: NoteType = { name, kind: 'cloze', fields: names, css, templates: [{ ord: 0, name, front, back }] };
    const n: Note = { id: 'io', deck: 'D', model: name, tags: [], fields };
    expect(templateOrdinals(n, io)).toEqual(Object.keys(cards).map(Number));
    for (const [ord, card] of Object.entries(cards)) {
      const rendered = renderTemplateCard(n, io, Number(ord));
      expect([rendered.front, rendered.back]).toEqual([card.front, card.back]);
    }
  });
});

describe('templateOrdinals', () => {
  it('skips a template whose front stays empty for this note', () => {
    expect(templateOrdinals(peru, geo)).toEqual([0, 1]);
    expect(templateOrdinals({ ...peru, fields: { ...peru.fields, Flag: '' } }, geo)).toEqual([0]);
  });

  it('makes a card only when the front fills in a non-empty field, whatever text it shows', () => {
    const nt: NoteType = { ...geo, fields: ['Front', 'Back', 'Extra'], templates: [{ ord: 0, name: 'T', front: '{{^Extra}}No extra{{/Extra}}{{Back}}', back: '' }] };
    const make = (fields: Record<string, string>) => templateOrdinals({ ...peru, fields: { Front: 'f', ...fields } }, nt);
    expect(make({ Back: '', Extra: 'x' })).toEqual([]);
    expect(make({ Back: 'b', Extra: 'x' })).toEqual([0]);
    expect(make({ Back: '&nbsp;', Extra: '' })).toEqual([0]);
  });

  /** Recorded from the real `anki` 26.09.4 package (tests/fixtures/anki/make-template-vectors.py). */
  it.each(vectors.cardgen)('$front with $case, tags $tags: $generates', ({ front, fields, tags, generates }) => {
    const nt: NoteType = {
      name: 'Gen', kind: 'normal', fields: ['Front', 'Back', 'Extra'], css: '',
      templates: [{ ord: 0, name: 'T0', front: '{{Front}}', back: '' }, { ord: 1, name: 'T1', front, back: '' }],
    };
    const note: Note = { id: 'n', deck: 'D::E', model: 'Gen', tags, fields };
    expect(templateOrdinals(note, nt).includes(1)).toBe(generates);
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

  it("defines anki.imageOcclusion before the card's own script calls it, with Anki's layout for it", () => {
    const { noteType, notes } = vectors.imageOcclusion;
    const front = notes[0].cards[0].front;
    const doc = cardDocument(front, { css: noteType.css, ord: 0, dark: false, autoplay: false });
    const head = doc.slice(0, doc.indexOf('<body'));
    expect(head).toContain('#image-occlusion-container img { position: absolute; top: 0; left: 0; width: 100%; height: 100%;');
    expect(head.indexOf('#image-occlusion-canvas {')).toBeLessThan(head.indexOf(noteType.css));
    const script = /<script>([\s\S]*?)<\/script><\/head>/.exec(doc)![1];
    const win: { anki?: { imageOcclusion: { setup: unknown } } } = {};
    new Function('window', 'document', script)(win, {});
    expect(typeof win.anki?.imageOcclusion.setup).toBe('function');
    expect(doc.indexOf('anki.imageOcclusion.setup();')).toBeGreaterThan(doc.indexOf('<body'));
  });

  it("paints the page in the app's colors when given them", () => {
    const doc = cardDocument('Hi', { css: '', ord: 0, dark: true, autoplay: false, colors: { background: '#123456', text: '#abcdef', cloze: '#fedcba' } });
    expect(doc).toContain('background: #123456; color: #abcdef;');
    expect(doc).toContain('.cloze { font-weight: bold; color: #fedcba; }');
  });

  it('keeps a deck\'s white .card background out of dark mode, after the deck\'s own CSS', () => {
    const css = '.card { background-color: white; color: black; }';
    const dark = cardDocument('Hi', { css, ord: 0, dark: true, autoplay: false, colors: { background: '#123456', text: '#abcdef', cloze: '#fedcba' } });
    expect(dark.indexOf('body.card { background: #123456; color: #abcdef; }')).toBeGreaterThan(dark.indexOf(css));
    expect(cardDocument('Hi', { css, ord: 0, dark: false, autoplay: false })).not.toContain('body.card {');
  });
});
