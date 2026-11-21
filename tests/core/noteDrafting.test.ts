import { describe, expect, it } from 'vitest';
import { applyTagSuggestion, canAddAnother, clozeChoices, nextNoteFields, typedTag, wrapCloze } from '../../src/core/noteDrafting';

describe('a cloze from the editor', () => {
  it('offers one past the highest number in any field, and that number again once there is one', () => {
    expect(clozeChoices({ Text: 'Idę do sklepu', Extra: '' })).toEqual({ next: 1, same: undefined });
    expect(clozeChoices({ Text: '{{c1::Idę}} do {{c3::sklepu}}', Extra: '{{c2::po}} {{c1,4::chleb}}' })).toEqual({ next: 5, same: 4 });
    // Nested clozes count, and c0 (which makes no card) doesn't.
    expect(clozeChoices({ Text: '{{c1::Paris {{c2::France}}}} {{c0::x}}' })).toEqual({ next: 3, same: 2 });
  });

  it('wraps the selection and keeps it selected inside the cloze', () => {
    const out = wrapCloze('Idę do sklepu po chleb.', { start: 17, end: 22 }, 2);
    expect(out.text).toBe('Idę do sklepu po {{c2::chleb}}.');
    expect(out.text.slice(out.selection.start, out.selection.end)).toBe('chleb');
  });

  it('puts an empty cloze at the cursor, with the cursor inside it', () => {
    const out = wrapCloze('Idę do ', { start: 7, end: 7 }, 1);
    expect(out.text).toBe('Idę do {{c1::}}');
    expect(out.selection).toEqual({ start: 13, end: 13 });
  });

  it('reads a selection made backward, and one past the end, as the text it covers', () => {
    expect(wrapCloze('kot pies', { start: 8, end: 4 }, 1).text).toBe('kot {{c1::pies}}');
    expect(wrapCloze('kot', { start: 9, end: 9 }, 1).text).toBe('kot{{c1::}}');
  });
});

describe('a suggested tag', () => {
  it('reads the word being typed, or none after a space', () => {
    expect(typedTag('polish an')).toBe('an');
    expect(typedTag('polish ')).toBe('');
    expect(typedTag('')).toBe('');
  });

  it('puts a tapped tag in place of the word being typed, ready for the next', () => {
    expect(applyTagSuggestion('polish an', 'animals')).toBe('polish animals ');
    expect(applyTagSuggestion('polish ', 'animals')).toBe('polish animals ');
    expect(applyTagSuggestion('', 'animals')).toBe('animals ');
  });
});

describe('save and add another', () => {
  it('is offered only for a note started from nothing', () => {
    expect(canAddAnother({})).toBe(true);
    expect(canAddAnother({ fields: undefined, choice: undefined })).toBe(true);
    expect(canAddAnother({ noteId: 'n1' })).toBe(false);
    expect(canAddAnother({ fields: { Entry: 'kot' } })).toBe(false);
    expect(canAddAnother({ choice: { entry: 'kot' } })).toBe(false);
  });

  it('keeps the fields marked to keep and blanks the rest', () => {
    expect(nextNoteFields(['Text', 'Back Extra', 'Source'], { Text: '{{c1::Idę}}', 'Back Extra': 'lesson 4' }, new Set(['Back Extra', 'Source'])))
      .toEqual({ Text: '', 'Back Extra': 'lesson 4', Source: '' });
  });
});
