import { describe, expect, it } from 'vitest';
import { formSegments, grammarText, isNoForm, keyFormValues, parseKeyForms, wordGrammar } from '../../src/core/wordGrammar';
import type { Note } from '../../src/core/types';

const note = (fields: Record<string, string>): Note => ({ id: 'n', model: 'Omnilanguage', deck: 'Polski', tags: [], fields: { Entry: 'x', Meaning: 'y', ...fields } });

describe('parseKeyForms', () => {
  it('reads one labeled form per line, with the pattern and what the word takes apart', () => {
    const parsed = parseKeyForms('pattern: Imperfective. Endings -ę, -isz.<br>I: dzwonię<br>you: dzwonisz<br>perfective: zadzwonić (zadzwonię)<br>takes: do + genitive (dzwonić do kogoś)');
    expect(parsed.pattern).toBe('Imperfective. Endings -ę, -isz.');
    expect(parsed.lines).toEqual([
      { label: 'I', value: 'dzwonię' }, { label: 'you', value: 'dzwonisz' }, { label: 'perfective', value: 'zadzwonić', detail: 'zadzwonię' },
    ]);
    expect(parsed.takes).toEqual({ label: 'takes', value: 'do + genitive', detail: 'dzwonić do kogoś' });
    expect(parsed.loose).toEqual([]);
  });
  it('keeps a line with no label whole, as the older notes wrote them', () => {
    expect(parseKeyForms('poniedziałku')).toEqual({ lines: [], loose: ['poniedziałku'] });
    expect(parseKeyForms('привлеку, привлечёшь (pfv., irreg. -чь verb)').loose).toEqual(['привлеку, привлечёшь (pfv., irreg. -чь verb)']);
    expect(parseKeyForms('<div>genitive: psa</div><div>psy</div>')).toMatchObject({ lines: [{ label: 'genitive', value: 'psa' }], loose: ['psy'] });
    expect(parseKeyForms(undefined)).toEqual({ lines: [], loose: [] });
  });
  it('lists the forms without their labels for the look-alike check', () => {
    expect(keyFormValues('pattern: Strong verb.<br>past: warf ab (irregular)<br>takes: an + accusative')).toEqual(['warf ab']);
    expect(keyFormValues('fui, era; iba')).toEqual(['fui', 'era', 'iba']);
  });
});

describe('formSegments', () => {
  it('splits a form where it stops matching the word', () => {
    expect(formSegments('poniedziałku', 'poniedziałek')).toEqual([{ text: 'poniedział', marked: false }, { text: 'ku', marked: true }]);
    expect(formSegments('Einstellungen', 'Einstellung')).toEqual([{ text: 'Einstellung', marked: false }, { text: 'en', marked: true }]);
    expect(formSegments('Dzwonię', 'dzwonić')).toEqual([{ text: 'Dzwoni', marked: false }, { text: 'ę', marked: true }]);
  });
  it('marks nothing when the form shares no real start with the word, or is the word', () => {
    expect(formSegments('warf ab', 'abwerfen')).toBeUndefined();
    expect(formSegments('zadzwonić', 'dzwonić')).toBeUndefined();
    expect(formSegments('dom', 'do')).toBeUndefined();
    expect(formSegments('poniedziałek', 'poniedziałek')).toBeUndefined();
  });
});

describe('wordGrammar', () => {
  it('builds the box from labeled key forms: the pattern, a cell per form, what it takes across the bottom', () => {
    const g = wordGrammar(note({
      Entry: 'dzwonić', KeyForms: 'pattern: Imperfective. Endings -ę, -isz.<br>I: dzwonię<br>perfective: zadzwonić (zadzwonię)<br>takes: do + genitive (dzwonić do kogoś)',
    }));
    expect(g).toEqual({
      pattern: 'Imperfective. Endings -ę, -isz.',
      cells: [
        { label: 'I', value: 'dzwonię', segments: [{ text: 'dzwoni', marked: false }, { text: 'ę', marked: true }] },
        { label: 'perfective', value: 'zadzwonić', detail: 'zadzwonię' },
        { label: 'takes', value: 'do + genitive', detail: 'dzwonić do kogoś', wide: true },
      ],
    });
    expect(grammarText(g!)).toBe('Imperfective. Endings -ę, -isz.\nI: dzwonię\nperfective: zadzwonić (zadzwonię)\ntakes: do + genitive (dzwonić do kogoś)');
  });
  it('says "none" for a field marked as having no form, and marks nothing in it', () => {
    const g = wordGrammar(note({ Entry: 'Ruhm', Plural: '-', Genitive: 'des Ruhmes' }));
    expect(g?.cells).toEqual([{ label: 'plural', value: 'none' }, { label: 'genitive', value: 'des Ruhmes' }]);
    expect(isNoForm(' - ')).toBe(true);
    expect(isNoForm('-er')).toBe(false);
  });
  it("adds the fields that hold one form each, unless a line already names that form", () => {
    const german = wordGrammar(note({ Entry: 'die Einstellung', Plural: 'Einstellungen', Genitive: 'der Einstellung', KeyForms: 'plural: Einstellungen (no singular use)' }));
    // The article isn't part of the word a form is compared with.
    expect(german?.cells).toEqual([
      { label: 'plural', value: 'Einstellungen', detail: 'no singular use', segments: [{ text: 'Einstellung', marked: false }, { text: 'en', marked: true }] },
      { label: 'genitive', value: 'der Einstellung' },
    ]);
    // "perfect: hat abgeworfen" says which auxiliary; without it the Auxiliary field is its own cell.
    expect(wordGrammar(note({ KeyForms: 'perfect: hat abgeworfen', Auxiliary: 'haben' }))?.cells.map((c) => c.label)).toEqual(['perfect']);
    expect(wordGrammar(note({ KeyForms: 'past: warf ab', Auxiliary: 'haben' }))?.cells.map((c) => c.label)).toEqual(['past', 'auxiliary']);
    expect(wordGrammar(note({ AspectPartner: 'добиться' }))?.cells).toEqual([{ label: 'aspect pair', value: 'добиться' }]);
  });
  it('takes the verb class as the pattern when no line gives one, and shows an unlabeled line whole', () => {
    expect(wordGrammar(note({ VerbClass: 'strong', KeyForms: 'warf ab' }))).toEqual({ pattern: 'strong', cells: [{ label: 'key forms', value: 'warf ab', wide: true }] });
    expect(wordGrammar(note({ VerbClass: 'strong', KeyForms: 'pattern: Strong verb. The prefix ab splits off.' }))?.pattern).toBe('Strong verb. The prefix ab splits off.');
  });
  it("leaves a Thai noun's counting word to its own box, and is undefined with nothing to show", () => {
    expect(wordGrammar(note({ Classifier: 'แห่ง' }), true)).toBeUndefined();
    expect(wordGrammar(note({ Classifier: '個' }))?.cells).toEqual([{ label: 'counting word', value: '個' }]);
    expect(wordGrammar(note({}))).toBeUndefined();
  });
});
