import { describe, expect, it } from 'vitest';
import { asksOwnHook, spokenMiss, typedMiss, typeItAnswer, typeItAnswers } from '../../src/core/activeRecall';
import { compareTyped, compareTypedAnswer, comparisonLine } from '../../src/core/typedCompare';
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

describe('typeItAnswers', () => {
  const japanese = (over: Record<string, string> = {}) =>
    ({ ...omniNote({ Entry: '食べる', Language: 'japanese', KanaReading: 'たべる', Transliteration: '', ...over }), deck: '👅 Languages::🍥 日本語' });
  it("takes a Japanese word's reading as well", () => {
    expect(typeItAnswers(japanese(), card('reverse'))).toEqual(['食べる', 'たべる']);
    expect(typeItAnswers(japanese({ KanaReading: 'きょう、こんにち' }), card('reverse'))).toEqual(['食べる', 'きょう', 'こんにち']);
  });
  it("takes the word with what the card puts before it: a noun's article, a Norwegian verb's å", () => {
    const norwegian = (over: Record<string, string>) => ({ ...omniNote({ Language: 'norwegian', Transliteration: '', ...over }), deck: 'Norsk' });
    expect(typeItAnswers(norwegian({ Entry: 'huske', PartOfSpeech: 'verb' }), card('reverse'))).toEqual(['huske', 'å huske']);
    expect(typeItAnswers(norwegian({ Entry: 'huske', PartOfSpeech: 'noun', Gender: 'f' }), card('reverse'))).toEqual(['huske', 'ei huske']);
    expect(typeItAnswers(norwegian({ Entry: 'å gå seg vill', PartOfSpeech: 'phrase' }), card('reverse'))).toEqual(['å gå seg vill']);
  });
  it("takes the romanization too, so a missing tone mark isn't every letter off", () => {
    const thai = omniNote({ Entry: 'ครั้ง', Transliteration: 'khráng' });
    expect(typeItAnswers(thai, card('reverse'))).toEqual(['ครั้ง', 'khráng']);
    const c = compareTypedAnswer(typeItAnswers(thai, card('reverse')), 'khrang');
    expect(c.sameLetters).toBe(true);
    expect(c.off).toBe(1);
    expect(comparisonLine(c)).toBe('Right letters, but one has the wrong accent or mark.');
    expect(typedMiss(c)).toBe(false);
  });
  it('takes only the word in another language, and nothing without Type it', () => {
    expect(typeItAnswers(omniNote({ Transliteration: '' }), card('reverse'))).toEqual(['หนังสือ']);
    expect(typeItAnswers(japanese(), card('forward'))).toEqual([]);
  });
});

describe('spokenMiss', () => {
  it('outlines Again only for a spoken answer nothing like the word, never for a mishearing', () => {
    // Misheard, but most of the word is there: not a miss.
    expect(spokenMiss(compareTyped('verletzung', 'verletzungen'))).toBe(false);
    expect(spokenMiss(compareTyped('schmetterling', 'schmetterlinge'))).toBe(false);
    expect(spokenMiss(compareTyped('pies', 'piec'))).toBe(false);
    // Another word altogether.
    expect(spokenMiss(compareTyped('verletzung', 'hund'))).toBe(true);
    expect(spokenMiss(compareTyped('kot', 'mysz'))).toBe(true);
    // Right, or nothing heard.
    expect(spokenMiss(compareTyped('kot', 'Kot'))).toBe(false);
    expect(spokenMiss(compareTyped('kot', ''))).toBe(false);
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

describe('typedMiss', () => {
  it('is a miss when letters are wrong', () => {
    expect(typedMiss(compareTyped('esperar', 'aguardar'))).toBe(true);
    expect(typedMiss(compareTyped('esperar', 'esperer'))).toBe(true);
  });
  it("isn't one when it's right, only an accent or the kana is off, or nothing was typed", () => {
    expect(typedMiss(compareTyped('esperar', 'Esperar'))).toBe(false);
    expect(typedMiss(compareTyped('canción', 'cancion'))).toBe(false);
    expect(typedMiss(compareTyped('ラーメン', 'らーめん'))).toBe(false);
    expect(typedMiss(compareTyped('esperar', ''))).toBe(false);
  });
});
