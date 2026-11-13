import { describe, expect, it } from 'vitest';
import { minedNote } from '../../src/reader/mining';

describe('mining', () => {
  it('starts the note as an Omnilanguage note with the word and its meaning', () => {
    expect(minedNote('ทอน', 'give change', 'Thai')).toEqual({ deck: 'Thai', model: 'Omnilanguage', fields: { Entry: 'ทอน', Meaning: 'give change' } });
    expect(minedNote('ทอน', null, 'Thai').fields.Meaning).toBe('');
  });
});
