import { describe, expect, it } from 'vitest';
import type { Note } from '../../src/core/types';
import type { AspectPair } from '../../src/reader/api';
import { hasAspectPairs, minedNote, pairFollowUp } from '../../src/reader/mining';

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

  describe('aspect pairs', () => {
    const AI = 'Written by AI. Check it before saving.';
    const pair = (over: Partial<AspectPair> = {}): AspectPair => ({ aspect: 'perfective', partner: 'wychodzić', partner_meaning: 'to go out', aspect_source: 'ai', ...over });
    const note = (id: string, fields: Record<string, string>, tags: string[] = [], deck = 'Polski'): Note => ({ id, deck, model: 'Omnilanguage', fields, tags });

    it('starts the note with its partner and aspect tag, to check before saving', () => {
      const mined = minedNote('wyjść', 'to get out', 'Polski', undefined, pair());
      expect(mined.fields).toEqual({ Entry: 'wyjść', Meaning: 'to get out', AspectPartner: 'wychodzić' });
      expect(mined.tags).toEqual(['perfective']);
      expect(mined.fieldNotes).toEqual({ AspectPartner: AI });
    });
    it('keeps the IPA note beside the partner note', () => {
      const mined = minedNote('wyjść', null, 'Polski', { ipa: '/vɨjɕt͡ɕ/', ipa_source: 'ai' }, pair());
      expect(mined.fieldNotes).toEqual({ Pronunciation: AI, AspectPartner: AI });
    });
    it('adds nothing when the server has no pair to suggest', () => {
      for (const none of [undefined, null, pair({ partner: null }), pair({ aspect: null }), pair({ partner: '' })]) {
        const mined = minedNote('kot', 'cat', 'Polski', undefined, none);
        expect(mined).toEqual({ deck: 'Polski', model: 'Omnilanguage', fields: { Entry: 'kot', Meaning: 'cat' } });
      }
    });

    const saved = note('s', { Entry: 'wyjść', Meaning: 'to get out', AspectPartner: 'wychodzić', Language: 'polish' }, ['verb', 'perfective']);
    it('offers a note for the partner when it is not in the deck, pointing back and tagged with the other aspect', () => {
      expect(pairFollowUp(saved, [saved], 'to go out')).toEqual({
        kind: 'add',
        partner: 'wychodzić',
        aspect: 'imperfective',
        target: {
          deck: 'Polski',
          model: 'Omnilanguage',
          fields: { Entry: 'wychodzić', Meaning: 'to go out', AspectPartner: 'wyjść', Language: 'polish' },
          fieldNotes: { Meaning: AI },
          tags: ['imperfective'],
        },
      });
    });
    it('offers nothing for a verb marked as having no partner', () => {
      const saved = note('s', { Entry: 'mieć', AspectPartner: '-' }, ['imperfective']);
      expect(pairFollowUp(saved, [saved])).toBeNull();
    });
    it('starts the partner with no meaning note when there is no meaning to check', () => {
      const offer = pairFollowUp(saved, [saved]);
      expect(offer?.kind === 'add' && offer.target.fields.Meaning).toBe('');
      expect(offer?.kind === 'add' && offer.target.fieldNotes).toBeUndefined();
    });
    it('offers to link a partner that is in the deck without a link back, tagging it only when it has no aspect tag', () => {
      const bare = note('p', { Entry: 'wychodzić', Meaning: 'to go out', AspectPartner: ' ' }, ['verb']);
      expect(pairFollowUp(saved, [saved, bare])).toEqual({
        kind: 'link', partner: 'wychodzić', word: 'wyjść', note: bare,
        fields: { Entry: 'wychodzić', Meaning: 'to go out', AspectPartner: 'wyjść' }, tags: ['verb', 'imperfective'],
      });
      const tagged = note('p', { Entry: 'wychodzić', AspectPartner: '' }, ['imperfective']);
      expect((pairFollowUp(saved, [saved, tagged]) as { tags: string[] }).tags).toEqual(['imperfective']);
    });
    it('finds the partner however its Entry is written', () => {
      const html = note('p', { Entry: ' Wychodzić<br>', AspectPartner: '' });
      expect(pairFollowUp(saved, [saved, html])?.kind).toBe('link');
    });
    it('has nothing to offer when the pair is already linked, or the partner lists another verb', () => {
      expect(pairFollowUp(saved, [saved, note('p', { Entry: 'wychodzić', AspectPartner: 'wyjść' })])).toBeNull();
      expect(pairFollowUp(saved, [saved, note('p', { Entry: 'wychodzić', AspectPartner: 'wyjść&nbsp;' })])).toBeNull();
      expect(pairFollowUp(saved, [saved, note('p', { Entry: 'wychodzić', AspectPartner: 'wejść' })])).toBeNull();
    });
    it('has nothing to offer for a note with no partner, or one that is its own partner', () => {
      expect(pairFollowUp(note('s', { Entry: 'kot', AspectPartner: ' ' }), [])).toBeNull();
      expect(pairFollowUp(note('s', { Entry: 'kot' }), [])).toBeNull();
      expect(pairFollowUp(note('s', { Entry: 'wyjść', AspectPartner: 'Wyjść' }), [])).toBeNull();
    });
    it('only matches a note of the same note type', () => {
      const other: Note = { ...note('p', { Entry: 'wychodzić', AspectPartner: '' }), model: 'Basic' };
      expect(pairFollowUp(saved, [saved, other])?.kind).toBe('add');
    });
    it('leaves the partner untagged when the saved note has no aspect tag', () => {
      const untagged = note('s', { Entry: 'wyjść', AspectPartner: 'wychodzić' });
      const offer = pairFollowUp(untagged, [untagged]);
      expect(offer?.kind === 'add' && offer.target.tags).toBeUndefined();
    });
  });
});

describe('which languages look a verb\'s aspect pair up', () => {
  it('is Russian and Polish only, never Toki Pona', () => {
    expect(['ru', 'pl', 'tok', 'th'].map((l) => hasAspectPairs(l as 'ru'))).toEqual([true, true, false, false]);
  });
});
