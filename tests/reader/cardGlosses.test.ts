import { describe, expect, it } from 'vitest';
import type { Card, Note } from '../../src/core/types';
import type { Word } from '../../src/reader/api';
import { dotOffsets, glossesOf, glossKey, glossRequests, MAX_SENTENCES, sentencePieces, wordBreaks } from '../../src/reader/cardGlosses';

const DECKS = { th: 'Languages::Thai', es: 'Languages::Spanish' };

const note = (id: string, deck: string, context: string | undefined, english = ''): Note => ({
  id, deck, model: 'Omnilanguage', tags: [],
  fields: { Entry: 'x', Meaning: 'y', ...(context === undefined ? {} : { Context: context, ContextTranslation: english }) },
});
const card = (noteId: string, extra: Partial<Card> = {}) => ({ id: `${noteId}:forward`, noteId, kind: 'forward', ...extra }) as Card;

const word = (text: string, status: Word['status'] = 'known'): Word => ({ text, status: text.trim() ? status : null, gloss: null, stretch: false, deck: true, grammar: null });

describe('the sentences a session asks about', () => {
  const notes = new Map([
    ['1', note('1', 'Languages::Thai::Food', 'เธอ<b>สูง</b>&nbsp;', 'She is <i>tall</i>.')],
    ['2', note('2', 'Languages::Thai', 'เธอสูง')],
    ['3', note('3', 'Languages::Spanish', 'Es alta.')],
    ['4', note('4', 'Trivia', 'Paris')],
    ['5', note('5', 'Languages::Thai', undefined)],
  ]);

  it('takes each sentence once, as plain text with its English, by the language of the card\'s deck', () => {
    const requests = glossRequests([card('1'), card('2'), card('3'), card('4'), card('5'), card('1', { kind: 'reverse' })], notes, DECKS);
    expect(requests).toEqual([
      { language: 'th', sentences: [{ text: 'เธอสูง', english: 'She is tall.' }] },
      { language: 'es', sentences: [{ text: 'Es alta.', english: '' }] },
    ]);
  });

  it("goes by a card's home deck, not the filtered deck it's in", () => {
    const filtered = card('4', { deck: 'Languages::Spanish', filteredDeck: 'Filtered' });
    expect(glossRequests([filtered], notes, DECKS)).toEqual([{ language: 'es', sentences: [{ text: 'Paris', english: '' }] }]);
  });

  it('leaves out sentences already asked about', () => {
    expect(glossRequests([card('1'), card('3')], notes, DECKS, new Set([glossKey('th', 'เธอสูง')])).map((r) => r.language)).toEqual(['es']);
  });

  it('asks about at most MAX_SENTENCES in one call', () => {
    const many = new Map(Array.from({ length: MAX_SENTENCES + 5 }, (_, i) => [`${i}`, note(`${i}`, 'Languages::Thai', `ประโยค ${i}`)]));
    expect(glossRequests([...many.keys()].map((id) => card(id)), many, DECKS)[0].sentences).toHaveLength(MAX_SENTENCES);
  });
});

describe("the server's answer", () => {
  const request = { language: 'th' as const, sentences: [{ text: 'เธอสูง', english: '' }, { text: 'กิน', english: '' }, { text: 'ไป', english: '' }] };

  it('is kept by sentence only where its words spell the sentence', () => {
    const kept = glossesOf(request, [[word('เธอ'), word('สูง')], [word('กิ')]]);
    expect([...kept.keys()]).toEqual([glossKey('th', 'เธอสูง')]);
  });
});

describe("a sentence's pieces", () => {
  const words = [word('เธอ'), word('สูง'), word('หนึ่ง'), word(' '), word('ร้อย')];

  it('carry the highlight into the word that holds it', () => {
    const pieces = sentencePieces(words, [{ text: 'เธอ', marked: false }, { text: 'สูง', marked: true }, { text: 'หนึ่ง ร้อย', marked: false }]);
    expect(pieces.map((p) => p.marked)).toEqual([false, true, false, false, false]);
    expect(pieces[1].parts).toEqual([{ text: 'สูง', marked: true }]);
  });

  it('cut a word the highlight covers only part of', () => {
    const pieces = sentencePieces([word('Einstellungen'), word(' '), word('sind')], [{ text: 'Ein', marked: false }, { text: 'stellungen', marked: true }, { text: ' sind', marked: false }]);
    expect(pieces[0].parts).toEqual([{ text: 'Ein', marked: false }, { text: 'stellungen', marked: true }]);
    expect(pieces[0].marked).toBe(true);
  });

  it('highlight nothing when the highlight spells another text', () => {
    expect(sentencePieces(words, [{ text: 'other', marked: true }]).some((p) => p.marked)).toBe(false);
  });

  it('break between two words that touch, not at a space or the end', () => {
    expect(wordBreaks(sentencePieces(words, undefined))).toEqual([true, true, false, false, false]);
  });
});

describe('the dots under a word', () => {
  it('start at its left edge and end at its right', () => {
    const dots = dotOffsets(42);
    expect(dots[0]).toBe(0);
    expect(dots[dots.length - 1] + 2).toBeCloseTo(42);
    expect(dots.length).toBe(9);
  });

  it('are one centered dot under a narrow word, and none under nothing', () => {
    expect(dotOffsets(4)).toEqual([1]);
    expect(dotOffsets(1)).toEqual([]);
  });
});
