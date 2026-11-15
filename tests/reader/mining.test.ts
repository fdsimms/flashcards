import { describe, expect, it } from 'vitest';
import { minedNote } from '../../src/reader/mining';

describe('mining', () => {
  it('starts the note as an Omnilanguage note with the word and its meaning', () => {
    expect(minedNote('ทอน', 'give change', 'Thai')).toEqual({ deck: 'Thai', model: 'Omnilanguage', fields: { Entry: 'ทอน', Meaning: 'give change' } });
    expect(minedNote('ทอน', null, 'Thai').fields.Meaning).toBe('');
  });
  it("starts the Pronunciation field as the word's IPA, and leaves it out when there is none", () => {
    const wiktionary = minedNote('доме', 'house', 'Русский', { ipa: '[ˈdomʲɪ]', ipa_source: 'wiktionary' });
    expect(wiktionary.fields).toEqual({ Entry: 'доме', Meaning: 'house', Pronunciation: '[ˈdomʲɪ]' });
    expect(wiktionary.fieldNotes).toBeUndefined();
    expect(minedNote('доме', 'house', 'Русский', { ipa: null, ipa_source: null }).fields).not.toHaveProperty('Pronunciation');
    expect(minedNote('доме', 'house', 'Русский', { ipa: '' }).fields).not.toHaveProperty('Pronunciation');
    expect(minedNote('доме', 'house', 'Русский').fields).not.toHaveProperty('Pronunciation');
  });
  it('says under the Pronunciation field that IPA written by AI should be checked before saving', () => {
    const note = minedNote('доме', 'house', 'Русский', { ipa: '/ˈdomʲɪ/', ipa_source: 'ai' });
    expect(note.fields.Pronunciation).toBe('/ˈdomʲɪ/');
    expect(note.fieldNotes).toEqual({ Pronunciation: 'Written by AI. Check it before saving.' });
  });
});
