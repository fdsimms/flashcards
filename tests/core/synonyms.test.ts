import { describe, expect, it } from 'vitest';
import { renderCard } from '../../src/core/cards';
import { meaningSet, sameMeaning, synonymIndex, wantedLine, wantedLines } from '../../src/core/synonyms';
import type { Note } from '../../src/core/types';
import { omniNote } from '../support/fixtures';

const es = (id: string, Entry: string, Meaning: string, over: Record<string, string> = {}): Note => ({
  ...omniNote({ Entry, Meaning, Language: 'Spanish', Transliteration: '', GenerateReverse: 'y', ...over }),
  id,
});
const ids = (notes: Note[] | undefined) => (notes ?? []).map((n) => n.id).sort();

describe('meaningSet / sameMeaning', () => {
  it('lowercases, strips markup and splits on ; and ,', () => {
    expect([...meaningSet(' To <b>Wait</b>;  to hope , to   expect ')]).toEqual(['to wait', 'to hope', 'to expect']);
    expect(meaningSet('<br>').size).toBe(0);
  });
  it('counts equal sets and one holding the other as the same, and an overlap as not', () => {
    expect(sameMeaning(meaningSet('to wait'), meaningSet('To wait'))).toBe(true);
    expect(sameMeaning(meaningSet('to wait'), meaningSet('to wait; to hope'))).toBe(true);
    expect(sameMeaning(meaningSet('to hope, to wait'), meaningSet('to wait; to hope'))).toBe(true);
    expect(sameMeaning(meaningSet('to wait; to stay'), meaningSet('to wait; to hope'))).toBe(false);
    expect(sameMeaning(meaningSet(''), meaningSet(''))).toBe(false);
  });
});

describe('synonymIndex', () => {
  it('links notes in one language whose meanings are the same, both ways', () => {
    const index = synonymIndex([
      es('a', 'esperar', 'to wait; to hope'), es('b', 'aguardar', 'to wait'), es('c', 'quedarse', 'to stay'),
    ]);
    expect(ids(index.get('a'))).toEqual(['b']);
    expect(ids(index.get('b'))).toEqual(['a']);
    expect(index.has('c')).toBe(false);
  });
  it('keeps languages apart, by Language field or else the deck', () => {
    const pt = { ...omniNote({ Entry: 'esperar', Meaning: 'to wait', Language: 'Portuguese' }), id: 'p' };
    const unknown = { ...omniNote({ Entry: 'wachten', Meaning: 'to wait', Language: '' }), id: 'u', deck: 'Talen::Klingon' };
    const index = synonymIndex([es('a', 'aguardar', 'to wait'), pt, unknown]);
    expect(index.size).toBe(0);
  });
  it("doesn't count the same word (a duplicate or homograph) as a synonym, articles aside", () => {
    const index = synonymIndex([es('a', 'el banco', 'bank'), es('b', 'banco', 'bank'), es('c', 'la orilla', 'bank')]);
    expect(ids(index.get('a'))).toEqual(['c']);
    expect(ids(index.get('c'))).toEqual(['a', 'b']);
  });
  it('leaves out notes that are not Omnilanguage', () => {
    const basic: Note = { id: 'x', deck: 'Spanish', model: 'Basic', fields: { Front: 'aguardar', Back: 'to wait' }, tags: [] };
    expect(synonymIndex([es('a', 'esperar', 'to wait'), basic]).size).toBe(0);
  });
});

describe('wantedLine', () => {
  it("shows the note's own part of speech and register when no synonym has them all", () => {
    const ookii = es('a', '大きい', 'big', { Language: 'Japanese', PartOfSpeech: 'i-adjective' });
    const ookina = es('b', '大きな', 'big; large', { Language: 'Japanese', PartOfSpeech: 'pre-noun adjectival' });
    expect(wantedLine(ookii, [ookina])).toBe('i-adjective');
    expect(wantedLine(ookina, [ookii])).toBe('pre-noun adjectival');
    const formal = es('c', 'aguardar', 'to wait', { PartOfSpeech: 'verb', Register: 'formal' });
    expect(wantedLine(formal, [es('d', 'esperar', 'to wait', { PartOfSpeech: 'Verb' })])).toBe('verb · formal');
  });
  it("names the synonyms' words, without articles, when the tags don't tell them apart", () => {
    const esperar = es('a', 'esperar', 'to wait', { PartOfSpeech: 'verb' });
    const aguardar = es('b', 'aguardar', 'to wait', { PartOfSpeech: 'verb', Register: 'formal' });
    expect(wantedLine(esperar, [aguardar])).toBe('Not: aguardar');
    expect(wantedLine(es('c', 'la casa', 'house'), [es('d', 'el hogar', 'house')])).toBe('Not: hogar');
  });
  it('counts the synonyms past three rather than listing them all', () => {
    const others = ['e', 'd', 'c', 'b', 'a'].map((w) => es(w, w, 'x'));
    expect(wantedLine(es('z', 'z', 'x'), others)).toBe('Not: a, b, c, and 2 more');
  });
  it('is undefined with no synonyms', () => {
    expect(wantedLine(es('a', 'esperar', 'to wait'), [])).toBeUndefined();
    expect(wantedLine(es('a', 'esperar', 'to wait'), undefined)).toBeUndefined();
  });
  it('gives each note with synonyms its line', () => {
    const lines = wantedLines([es('a', 'esperar', 'to wait'), es('b', 'aguardar', 'to wait'), es('c', 'casa', 'house')]);
    expect([...lines]).toEqual([['a', 'Not: aguardar'], ['b', 'Not: esperar']]);
  });
});

describe("the line on a reverse card's front", () => {
  const esperar = es('a', 'esperar', 'to wait', { LeechHint: 'not quedarse' });
  const aguardar = es('b', 'aguardar', 'to wait');

  it('shows under the meaning and before the leech hint', () => {
    const front = renderCard(esperar, 'reverse', wantedLines([esperar, aguardar]).get('a')).front.blocks;
    expect(front.map((b) => [b.text, b.role])).toEqual([['to wait', undefined], ['Not: aguardar', 'wanted'], ['not quedarse', undefined]]);
  });
  it('is not there for a note without synonyms', () => {
    const front = renderCard(esperar, 'reverse', wantedLines([esperar]).get('a')).front.blocks;
    expect(front.map((b) => b.text)).toEqual(['to wait', 'not quedarse']);
  });
});
