import { describe, expect, it } from 'vitest';
import { aboutWord, pieces, prepositionNote } from '../../src/reader/formPrimer';

describe('pieces', () => {
  it('marks the text between asterisks', () => {
    expect(pieces('Я пишу ручк*ой*')).toEqual([
      { text: 'Я пишу ручк', marked: false },
      { text: 'ой', marked: true },
    ]);
  });

  it('handles a mark at the start, several marks and no marks', () => {
    expect(pieces('*Будем* читать *сегодня*')).toEqual([
      { text: 'Будем', marked: true },
      { text: ' читать ', marked: false },
      { text: 'сегодня', marked: true },
    ]);
    expect(pieces('no ending')).toEqual([{ text: 'no ending', marked: false }]);
    expect(pieces('')).toEqual([]);
  });

  it('keeps a table cell whose whole text is marked', () => {
    expect(pieces('*-ом* / *-ем*')).toEqual([
      { text: '-ом', marked: true },
      { text: ' / ', marked: false },
      { text: '-ем', marked: true },
    ]);
  });
});

describe('aboutWord', () => {
  it('names the form, the dictionary form and what the word means there', () => {
    expect(aboutWord({ text: 'Чем', lemma: 'что', gloss: 'with what' }, 'instrumental case')).toBe(
      'Чем is the instrumental case of что. Here it means "with what".',
    );
  });

  it('leaves out what the server did not send', () => {
    expect(aboutWord({ text: 'snakket', lemma: 'snakke', gloss: null }, 'past tense')).toBe('snakket is the past tense of snakke.');
    expect(aboutWord({ text: 'snakket', gloss: 'talked' }, 'past tense')).toBe('snakket is the past tense. Here it means "talked".');
  });
});

describe('prepositionNote', () => {
  it('says which preposition and case give the meaning, and what it comes to', () => {
    expect(prepositionNote({ id: 'prepositional', name: 'prepositional case', preposition: 'в', phrase: 'in hoods' })).toBe(
      'в + prepositional: in hoods',
    );
    expect(prepositionNote({ id: 'instrumental', name: 'instrumental case', preposition: 'с', phrase: 'with a friend' })).toBe(
      'с + instrumental: with a friend',
    );
  });

  it('is nothing when no preposition governs the word', () => {
    expect(prepositionNote({ id: 'instrumental', name: 'instrumental case' })).toBeNull();
    expect(prepositionNote({ id: 'past', name: 'past tense', preposition: '', phrase: '' })).toBeNull();
    expect(prepositionNote({ id: 'prepositional', name: 'prepositional case', preposition: 'в' })).toBeNull();
  });
});
