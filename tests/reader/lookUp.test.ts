import { describe, expect, it } from 'vitest';
import type { Word } from '../../src/reader/api';
import { bareWord, canAdd, contextAround, formOf, lookedUpWords, lookUpStatus, MAX_CONTEXT, wordIn } from '../../src/reader/lookUp';

const w = (text: string, over: Partial<Word> = {}): Word => ({ ...bareWord(text), status: 'known', ...over });
const space: Word = { ...bareWord(' '), status: null };

describe('finding the tapped word', () => {
  const words = [w('Nos'), space, w('vemos'), space, w('después', { gloss: 'after' }), space, w('de clase', { status: 'unknown' })];

  it('takes the word spelled the same, ignoring case', () => {
    expect(wordIn(words, 'Después').gloss).toBe('after');
    expect(wordIn(words, 'nos').text).toBe('Nos');
  });

  it('takes a word the server joined or split differently', () => {
    expect(wordIn(words, 'clase').text).toBe('de clase');
  });

  it('falls back to the word alone, which is asked about by itself', () => {
    expect(wordIn(words, ' biblioteca ')).toEqual(bareWord('biblioteca'));
    expect(lookedUpWords(words)).toHaveLength(4);
  });
});

describe('the text around a tapped word', () => {
  it('keeps short text whole and cuts long text around the word', () => {
    expect(contextAround('  Nos  vemos\nluego. ', 'vemos')).toBe('Nos vemos luego.');
    const long = `${'a '.repeat(600)}palabra ${'b '.repeat(600)}`;
    const cut = contextAround(long, 'palabra');
    expect(cut.length).toBeLessThanOrEqual(MAX_CONTEXT);
    expect(cut).toContain('palabra');
  });
});

describe('what the lookup says about a word', () => {
  it('says where it stands', () => {
    expect(lookUpStatus({ status: 'known', deck: true })).toBe('In your deck');
    expect(lookUpStatus({ status: 'known', deck: false, wanikani: true })).toBe('Learned in WaniKani');
    expect(lookUpStatus({ status: 'known', deck: false })).toBe('A common word you know');
    expect(lookUpStatus({ status: 'partial', deck: false })).toBe('Only in a phrase in your deck');
    expect(lookUpStatus({ status: 'unknown', deck: true })).toBe('In your deck, not studied yet');
    expect(lookUpStatus({ status: 'unknown', deck: false })).toBe('Not in your deck');
  });

  it('offers Add to deck for a word the deck lacks, never a name', () => {
    expect(canAdd({ deck: false, status: 'unknown' })).toBe(true);
    expect(canAdd({ deck: true, status: 'known' })).toBe(false);
    expect(canAdd({ deck: false, status: 'name' })).toBe(false);
  });

  it('names the dictionary form when the word is a form of it', () => {
    expect(formOf({ text: 'pieszych', lemma: 'pieszy' })).toBe('A form of pieszy');
    expect(formOf({ text: 'Kot', lemma: 'kot' })).toBeNull();
    expect(formOf({ text: 'kot', lemma: null })).toBeNull();
  });
});
