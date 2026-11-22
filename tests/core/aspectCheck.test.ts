import { describe, expect, it } from 'vitest';
import { ASPECT_MISS_RATING, aspectCheckOn, aspectToCheck, aspectVerdict, deckHasAspectLanguage } from '../../src/core/aspectCheck';
import type { DeckSettings } from '../../src/core/types';
import { omniNote } from '../support/fixtures';

const verb = (tags: string[], language = 'Russian') => ({ ...omniNote({ Entry: 'пропадать', Meaning: 'to disappear', Language: language }), tags });

describe('aspectToCheck', () => {
  it('asks about a Russian or Polish verb tagged with one aspect, on its forward card', () => {
    expect(aspectToCheck(verb(['verb', 'imperfective']), { kind: 'forward' })).toBe('imperfective');
    expect(aspectToCheck(verb(['Perfective']), { kind: 'forward' })).toBe('perfective');
    expect(aspectToCheck(verb(['imperfective'], 'Polish'), { kind: 'forward' })).toBe('imperfective');
  });
  it('asks nothing of other cards, languages and notes', () => {
    expect(aspectToCheck(verb(['imperfective']), { kind: 'reverse' })).toBeUndefined();
    expect(aspectToCheck(verb(['imperfective']), { kind: 'audio' })).toBeUndefined();
    expect(aspectToCheck(verb(['imperfective'], 'German'), { kind: 'forward' })).toBeUndefined();
    expect(aspectToCheck(verb(['noun']), { kind: 'forward' })).toBeUndefined();
    expect(aspectToCheck(verb(['perfective', 'imperfective']), { kind: 'forward' })).toBeUndefined();
    expect(aspectToCheck({ ...verb(['imperfective']), fields: { Front: 'a', Back: 'b' } }, { kind: 'forward' })).toBeUndefined();
  });
});

describe('deckHasAspectLanguage', () => {
  const inDeck = (deck: string, language: string) => ({ ...omniNote({ Entry: 'x', Meaning: 'y', Language: language }), deck });
  it('is true when the deck or a subdeck has Russian or Polish notes', () => {
    expect(deckHasAspectLanguage('Languages', [inDeck('Languages::Russian', 'Russian')])).toBe(true);
    expect(deckHasAspectLanguage('Polski', [inDeck('Polski', 'Polish')])).toBe(true);
  });
  it('is false for other languages, other decks and an empty deck', () => {
    expect(deckHasAspectLanguage('Toki Pona', [inDeck('Toki Pona', 'Toki Pona')])).toBe(false);
    expect(deckHasAspectLanguage('Languages::German', [inDeck('Languages::Russian', 'Russian')])).toBe(false);
    expect(deckHasAspectLanguage('Empty', [])).toBe(false);
  });
});

describe('aspectCheckOn', () => {
  it('is on unless the deck or an ancestor turns it off', () => {
    const all = new Map<string, DeckSettings>([['Languages', { aspectCheck: false }]]);
    expect(aspectCheckOn('Languages::Russian', all)).toBe(false);
    expect(aspectCheckOn('Languages::Russian', new Map([...all, ['Languages::Russian', { aspectCheck: true }]]))).toBe(true);
    expect(aspectCheckOn('Other', all)).toBe(true);
  });
});

describe('aspectVerdict', () => {
  it('says whether the pick was right', () => {
    expect(aspectVerdict('imperfective', 'imperfective')).toEqual({ right: true, text: 'Imperfective: correct' });
    expect(aspectVerdict('imperfective', 'perfective')).toEqual({ right: false, text: "It's imperfective" });
  });
  it('outlines Hard after a miss', () => expect(ASPECT_MISS_RATING).toBe(2));
});
