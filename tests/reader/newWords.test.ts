import { describe, expect, it } from 'vitest';
import type { Card, Note } from '../../src/core/types';
import type { WordSuggestions } from '../../src/reader/api';
import {
  cardsPerNote, decksWaiting, dismissOn, entryKeys, firstTicked, heldKeys, inDeck, lowDecks, parseDismissals,
  runwayText, suggestionDetail, suggestionSections, tickedEntries, wordsToTick,
} from '../../src/reader/newWords';

const ES = '👅 Languages::🌮 Español';
const TH = '👅 Languages::🐘 ภาษาไทย';
const options = [{ deck: ES, language: 'es' as const }, { deck: TH, language: 'th' as const }];

const low = (rows: { deck: string; unstudied: number; newPerDay?: number }[], over: Partial<Parameters<typeof lowDecks>[0]> = {}) =>
  lowDecks({ options, rows, waiting: new Set(), dismissed: () => false, onVacation: false, ...over });

describe('which language decks are running low', () => {
  it('is a deck with under three days of new cards at its own limit, the lowest first', () => {
    const rows = [{ deck: ES, unstudied: 20, newPerDay: 10 }, { deck: TH, unstudied: 29, newPerDay: 10 }];
    expect(low(rows).map((d) => [d.deck, d.left, d.perDay])).toEqual([[ES, 20, 10], [TH, 29, 10]]);
    // Exactly three days is enough.
    expect(low([{ deck: ES, unstudied: 30, newPerDay: 10 }])).toEqual([]);
  });
  it('counts a deck with none left', () => {
    expect(low([{ deck: ES, unstudied: 0, newPerDay: 10 }]).map((d) => d.left)).toEqual([0]);
  });
  it('leaves out a deck taking no new cards, a row without its limit, and a deck not in the options', () => {
    expect(low([{ deck: ES, unstudied: 0, newPerDay: 0 }, { deck: TH, unstudied: 0 }, { deck: 'Trivia', unstudied: 0, newPerDay: 10 }])).toEqual([]);
  });
  it('leaves out a deck with words waiting, one dismissed today, and every deck on vacation', () => {
    const rows = [{ deck: ES, unstudied: 5, newPerDay: 10 }, { deck: TH, unstudied: 5, newPerDay: 10 }];
    expect(low(rows, { waiting: new Set([ES]) }).map((d) => d.deck)).toEqual([TH]);
    expect(low(rows, { dismissed: (d) => d === TH }).map((d) => d.deck)).toEqual([ES]);
    expect(low(rows, { onVacation: true })).toEqual([]);
  });
  it('knows which decks have words queued or held', () => {
    expect([...decksWaiting([{ deck: ES }], [{ deck: TH, entries: [{}] }, { deck: 'Empty', entries: [] }])]).toEqual([ES, TH]);
  });
});

describe('what the card says', () => {
  it('counts whole days, and says when less than one or none is left', () => {
    expect(runwayText(25, 10)).toBe('2 days of new cards left');
    expect(runwayText(10, 10)).toBe('1 day of new cards left');
    expect(runwayText(4, 10)).toBe('Less than a day of new cards left');
    expect(runwayText(0, 10)).toBe('No new cards left');
  });
});

describe('how many words start ticked', () => {
  const note = (id: string, deck: string): Note => ({ id, deck, model: 'Omnilanguage', fields: {}, tags: [] });
  const card = (id: string, noteId: string, retired = false) => ({ id, noteId, retired } as unknown as Card);
  it('reads cards per note from the deck and its subdecks, leaving out retired cards', () => {
    const notes = [note('a', ES), note('b', `${ES}::Verbs`), note('c', TH)];
    const cards = [card('1', 'a'), card('2', 'a'), card('3', 'a', true), card('4', 'b'), card('5', 'b'), card('6', 'b'), card('7', 'c')];
    expect(cardsPerNote(ES, notes, cards)).toBe(2.5);
    expect(cardsPerNote('Nothing', notes, cards)).toBe(1);
  });
  it('ticks three days of cards in notes, at least one and at most fifty', () => {
    expect(wordsToTick(10, 3)).toBe(10);
    expect(wordsToTick(10, 2.5)).toBe(12);
    expect(wordsToTick(100, 1)).toBe(50);
    expect(wordsToTick(1, 5)).toBe(1);
  });
});

describe('the suggested words', () => {
  const s: WordSuggestions = {
    texts: [
      { word: 'aprovechar', meaning: 'to make the most of', rank: 1200, texts: 4 },
      { word: 'receta', meaning: 'prescription', rank: 2400, texts: 2 },
      { word: 'madrugada', meaning: '', rank: null, texts: 1 },
    ],
    common: [
      { word: 'quedarse', meaning: 'to stay', rank: 212, texts: 0 },
      { word: 'desarrollar', meaning: '', rank: 1640, texts: 0 },
    ],
  };
  it('leaves out what the deck has now, by entry with or without its article, and what is held or dismissed', () => {
    const entries = entryKeys(['la receta', 'Hablar', '']);
    expect(inDeck('Receta', entries)).toBe(true);
    expect(inDeck('hablar', entries)).toBe(true);
    const sections = suggestionSections(s, entries, heldKeys([{ deck: ES, entries: [{ entry: 'Madrugada' }] }, { deck: TH, entries: [{ entry: 'quedarse' }] }], ES), new Set(['desarrollar']));
    expect(sections.map((x) => [x.key, x.words.map((w) => w.word)])).toEqual([['texts', ['aprovechar']], ['common', ['quedarse']]]);
  });
  it('drops a section with nothing left', () => {
    expect(suggestionSections({ texts: [], common: s.common }, new Set(), new Set(), new Set()).map((x) => x.title)).toEqual(['Common words not in the deck']);
  });
  it('ticks the first words in the order shown, and sends them with no meaning so Claude writes one', () => {
    const sections = suggestionSections(s, new Set(), new Set(), new Set());
    const ticked = firstTicked(sections, 4);
    expect([...ticked]).toEqual(['aprovechar', 'receta', 'madrugada', 'quedarse']);
    expect(tickedEntries(sections, new Set(['quedarse', 'receta']))).toEqual([{ entry: 'receta', meaning: '' }, { entry: 'quedarse', meaning: '' }]);
  });
  it('says the meaning and where each word came from', () => {
    expect(suggestionDetail(s.texts[0])).toBe('to make the most of · in 4 texts');
    expect(suggestionDetail(s.texts[2])).toBe('in 1 text');
    expect(suggestionDetail(s.common[1])).toBe('#1,640 most common');
    expect(suggestionDetail({ word: 'x', meaning: '', rank: null, texts: 0 })).toBe('');
  });
});

describe("dismissing Today's card", () => {
  it('hides it for the rest of the study day, and forgets older days', () => {
    const d = dismissOn({ [TH]: '2026-11-17' }, ES, '2026-11-18');
    expect(d).toEqual({ [ES]: '2026-11-18' });
    expect(parseDismissals(JSON.stringify(d))).toEqual(d);
  });
  it('reads anything else as nothing dismissed', () => {
    expect(parseDismissals(null)).toEqual({});
    expect(parseDismissals('not json')).toEqual({});
    expect(parseDismissals('[1]')).toEqual({});
    expect(parseDismissals(JSON.stringify({ [ES]: 3 }))).toEqual({});
  });
});
