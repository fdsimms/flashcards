import { describe, expect, it } from 'vitest';
import { missedCardText } from '../../src/core/missedCard';
import type { Note, NoteType } from '../../src/core/types';

const presidents: NoteType = {
  name: 'U.S. Presidents',
  kind: 'normal',
  fields: ['Order', 'Name', 'Face'],
  css: '',
  templates: [
    { ord: 0, name: 'Order to name', front: '{{Order}}', back: '{{FrontSide}}<hr id=answer>{{Name}}' },
    { ord: 1, name: 'Face to name', front: '{{Face}}', back: '{{FrontSide}}<hr id=answer>{{Name}}' },
  ],
};

const note = (fields: Record<string, string>): Note => ({ id: 'n1', deck: 'Trivia', model: 'U.S. Presidents', fields, tags: [] });
const adams = note({ Order: '6th', Name: 'John Quincy Adams', Face: '<img src="jqa.png" />' });

describe('missedCardText', () => {
  it('gives the question and, after the answer line, only the answer', () => {
    expect(missedCardText(adams, presidents, 't0')).toEqual({ question: '6th', answer: 'John Quincy Adams', cardName: 'Order to name' });
  });

  it('says Picture for a side that is only an image', () => {
    expect(missedCardText(adams, presidents, 't1')?.question).toBe('Picture');
  });

  it('leaves out the card name when the note type has one card type', () => {
    const one = { ...presidents, templates: [presidents.templates[0]] };
    expect(missedCardText(adams, one, 't0')?.cardName).toBeUndefined();
  });

  it('takes a back with no FrontSide as the answer', () => {
    const plain: NoteType = { ...presidents, templates: [{ ord: 0, name: 'Card 1', front: '{{Order}}', back: '{{Name}}' }] };
    expect(missedCardText(adams, plain, 't0')?.answer).toBe('John Quincy Adams');
  });

  it('is undefined when both sides read the same, as with a template that hides parts by CSS', () => {
    const table: NoteType = { ...presidents, templates: [{ ord: 0, name: 'Card 1', front: '{{Order}} {{Name}}', back: '{{FrontSide}}' }] };
    expect(missedCardText(adams, table, 't0')).toBeUndefined();
  });

  it('is undefined for Omnilanguage kinds, a missing note type and an empty side', () => {
    expect(missedCardText(adams, presidents, 'forward')).toBeUndefined();
    expect(missedCardText(adams, undefined, 't0')).toBeUndefined();
    expect(missedCardText(note({ Order: '6th', Name: '', Face: '' }), presidents, 't0')).toBeUndefined();
  });
});

describe('missedCardText for a skill drill', () => {
  it('has no card text, since its back is the same line on every drill', () => {
    const noteType = { id: 'b', name: 'Basic', kind: 'normal', fields: ['Front', 'Back'], templates: [{ ord: 0, name: 'Card 1', qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr id=answer>{{Back}}' }], css: '' } as never;
    const note = { id: 'n', deck: 'Norsk::Skills', model: 'b', fields: { Front: '<div><b>Norwegian · Saying dates: Day and month</b></div><div>Say today\'s date.</div>', Back: '<div>Rate how it went.</div>' }, tags: ['skill', 'skill::drill::dates-1', 'skill::lang::no'] } as never;
    expect(missedCardText(note, noteType, 't0')).toBeUndefined();
  });
});
