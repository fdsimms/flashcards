import { describe, expect, it } from 'vitest';
import { asksOwnHook, typeItAnswer } from '../../src/core/activeRecall';
import { newSchedState } from '../../src/core/scheduler';
import type { Card, Note } from '../../src/core/types';
import { NOW, omniNote } from '../support/fixtures';

function card(kind: Card['kind'], over: Partial<Card['sched']> = {}): Card {
  return { id: `n1:${kind}`, noteId: 'n1', kind, suspended: false, retired: false, sched: { ...newSchedState(NOW), ...over } };
}

const basic: Note = { id: 'b1', deck: 'Trivia', model: 'Basic', fields: { Front: 'Capital of Peru', Back: 'Lima' }, tags: [] };

describe('typeItAnswer', () => {
  it('asks for the word on an Omnilanguage reverse card', () => {
    expect(typeItAnswer(omniNote({ Entry: '<b>esperar</b>' }), card('reverse'))).toBe('esperar');
  });
  it('offers nothing on a forward card or another note type', () => {
    expect(typeItAnswer(omniNote(), card('forward'))).toBeUndefined();
    expect(typeItAnswer(basic, { ...card('reverse'), noteId: 'b1' })).toBeUndefined();
  });
  it('offers nothing when the note has no word', () => {
    expect(typeItAnswer(omniNote({ Entry: '' }), card('reverse'))).toBeUndefined();
  });
});

describe('asksOwnHook', () => {
  it('asks the first time a new word is shown', () => {
    expect(asksOwnHook(omniNote(), card('forward'), [card('forward'), card('reverse')])).toBe(true);
  });
  it("doesn't ask once any card of the note has been answered", () => {
    expect(asksOwnHook(omniNote(), card('forward'), [card('reverse', { state: 1, reps: 1 })])).toBe(false);
    expect(asksOwnHook(omniNote(), card('forward', { state: 1, reps: 1 }), [])).toBe(false);
  });
  it("doesn't ask a card answered before and forgotten back to new", () => {
    expect(asksOwnHook(omniNote(), card('forward', { reps: 4 }), [])).toBe(false);
  });
  it("doesn't ask when the note already has a mnemonic, or isn't Omnilanguage", () => {
    expect(asksOwnHook(omniNote({ Mnemonic: 'a book on a bed' }), card('forward'), [])).toBe(false);
    expect(asksOwnHook(omniNote({ Mnemonic: '<br>' }), card('forward'), [])).toBe(true);
    expect(asksOwnHook(basic, { ...card('forward'), noteId: 'b1' }, [])).toBe(false);
  });
});
