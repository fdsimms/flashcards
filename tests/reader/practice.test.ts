import { describe, expect, it } from 'vitest';
import type { Note } from '../../src/core/types';
import { languageOfDeck, practiceWords } from '../../src/reader/practice';

const DECKS = { th: 'Languages::Thai', es: 'Languages::Spanish' };

const note = (id: string, entry: string | undefined, model = 'Omnilanguage'): Note => ({
  id, deck: 'Languages::Thai', model, tags: [], fields: entry === undefined ? { Front: 'x' } : { Entry: entry, Meaning: 'm' },
});

describe('the language of a deck', () => {
  it('is the language whose deck it is or is inside', () => {
    expect(languageOfDeck('Languages::Thai', DECKS)).toBe('th');
    expect(languageOfDeck('Languages::Thai::Food', DECKS)).toBe('th');
    expect(languageOfDeck('Languages::Spanish', DECKS)).toBe('es');
  });
  it('is none for a deck holding both, or neither', () => {
    expect(languageOfDeck('Languages', DECKS)).toBeNull();
    expect(languageOfDeck('Trivia', DECKS)).toBeNull();
    expect(languageOfDeck('Languages::Thaiish', DECKS)).toBeNull();
  });
  it('is the one language under a deck above it', () => {
    expect(languageOfDeck('Languages', { th: 'Languages::Thai', es: 'Spanish' })).toBe('th');
  });
});

describe('the words a session practiced', () => {
  const notes = new Map([
    ['1', note('1', '<b>กิน</b>&nbsp;')],
    ['2', note('2', 'ครับ')],
    ['3', note('3', undefined, 'Basic')],
    ['4', note('4', 'hola')],
  ]);

  it("takes each note's Entry as plain text, once, in the order answered", () => {
    const answered = [
      { noteId: '2', deck: 'Languages::Thai' },
      { noteId: '1', deck: 'Languages::Thai::Food' },
      { noteId: '2', deck: 'Languages::Thai' },
    ];
    expect(practiceWords(answered, notes, 'Languages::Thai')).toEqual(['ครับ', 'กิน']);
  });

  it("leaves out other note types and cards outside the language's deck", () => {
    const answered = [{ noteId: '3', deck: 'Languages::Thai' }, { noteId: '4', deck: 'Languages::Spanish' }];
    expect(practiceWords(answered, notes, 'Languages::Thai')).toEqual([]);
  });
});
