import { describe, expect, it } from 'vitest';
import { contrastRows, contrastWords, withoutContrastWord } from '../../src/core/senseContrast';
import type { Note } from '../../src/core/types';
import { omniNote } from '../support/fixtures';

const spanish = (id: string, over: Record<string, string>): Note => ({ ...omniNote({ Language: 'spanish', Transliteration: '', ...over }), id, deck: 'Español' });
const ducha = spanish('n1', { Entry: 'ducha', Meaning: 'shower', Sense: 'a bathroom shower, not rain', SenseContrast: 'rain shower = aguacero; chubasco<br>baby shower = baby shower' });

describe('senseContrast', () => {
  it('reads a pair per line, and a row per word when a pair lists two', () => {
    expect(contrastWords('rain shower = aguacero; chubasco<br>baby shower = fiesta')).toEqual([
      { sense: 'rain shower', word: 'aguacero' }, { sense: 'rain shower', word: 'chubasco' }, { sense: 'baby shower', word: 'fiesta' },
    ]);
    // Anki's editor writes a second line as a div, and a pasted one may carry markup.
    expect(contrastWords('<b>rain shower</b> = aguacero<div>house painter=pintor de brocha gorda</div>')).toEqual([
      { sense: 'rain shower', word: 'aguacero' }, { sense: 'house painter', word: 'pintor de brocha gorda' },
    ]);
    // A line that names no word, or no sense, says nothing.
    expect(contrastWords('rain shower<br>= aguacero<br>rain shower = <br>')).toEqual([]);
    expect(contrastWords('')).toEqual([]);
  });

  it('takes one word out, and its pair with it when that was the only word', () => {
    const one = withoutContrastWord(ducha.fields, { sense: 'rain shower', word: 'chubasco' });
    expect(one.SenseContrast).toBe('rain shower = aguacero<br>baby shower = baby shower');
    const both = withoutContrastWord(one, { sense: 'rain shower', word: 'aguacero' });
    expect(both.SenseContrast).toBe('baby shower = baby shower');
    expect(withoutContrastWord(both, { sense: 'baby shower', word: 'baby shower' }).SenseContrast).toBe('');
    // Every other field is left as it was.
    expect({ ...both, SenseContrast: '' }).toEqual({ ...ducha.fields, SenseContrast: '' });
  });

  it('changes nothing when the word is not there, or the note type has no such field', () => {
    expect(withoutContrastWord(ducha.fields, { sense: 'rain shower', word: 'lluvia' })).toBe(ducha.fields);
    const { SenseContrast: _gone, ...older } = ducha.fields;
    expect(withoutContrastWord(older, { sense: 'rain shower', word: 'aguacero' })).toBe(older);
  });

  it('finds a word already in the deck by its Entry, in the same language only', () => {
    const notes = [
      ducha,
      spanish('n2', { Entry: '<b>Aguacero</b>', Meaning: 'downpour' }),
      // The same spelling in another language is another word.
      { ...omniNote({ Entry: 'chubasco', Language: 'portuguese', Transliteration: '' }), id: 'n3', deck: 'Português' },
      // A note of another type with a matching front is not a word of this deck.
      { id: 'n4', deck: 'Español', model: 'Basic', fields: { Front: 'chubasco', Back: 'squall' }, tags: [] },
    ];
    expect(contrastRows(ducha, notes)).toEqual([
      { sense: 'rain shower', word: 'aguacero', state: 'inDeck', noteId: 'n2' },
      { sense: 'rain shower', word: 'chubasco', state: 'new' },
      { sense: 'baby shower', word: 'baby shower', state: 'new' },
    ]);
  });

  it('shows a word waiting in the note queue as added, until its note exists', () => {
    expect(contrastRows(ducha, [ducha], ['Chubasco']).map((r) => r.state)).toEqual(['new', 'queued', 'new']);
    const added = [ducha, spanish('n5', { Entry: 'chubasco' })];
    expect(contrastRows(ducha, added, ['chubasco'])[1]).toEqual({ sense: 'rain shower', word: 'chubasco', state: 'inDeck', noteId: 'n5' });
  });

  it('never matches the note against itself, and has no rows without the field', () => {
    const self = spanish('n6', { Entry: 'ducha', SenseContrast: 'shower = ducha' });
    expect(contrastRows(self, [self])[0].state).toBe('new');
    expect(contrastRows(spanish('n7', { Entry: 'pintor' }), [ducha])).toEqual([]);
  });
});
