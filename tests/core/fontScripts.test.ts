import { describe, expect, it } from 'vitest';
import { deckScripts, scriptsIn } from '../../src/core/fontScripts';
import type { Note } from '../../src/core/types';

const note = (deck: string, fields: Record<string, string>, id = Math.random().toString()): Note => ({ id, deck, fields } as unknown as Note);

describe('scriptsIn', () => {
  it('finds each script besides Latin', () => {
    expect(scriptsIn('hello')).toEqual([]);
    expect(scriptsIn('увидеть')).toEqual(['cyrillic']);
    expect(scriptsIn('θάλασσα')).toEqual(['greek']);
    expect(scriptsIn('ทะเล')).toEqual(['thai']);
    expect(scriptsIn('忘れる')).toEqual(['japanese']);
    expect(scriptsIn('ひらがな カタカナ')).toEqual(['japanese']);
    expect(scriptsIn('Привет, 世界')).toEqual(['cyrillic', 'japanese']);
  });
});

describe('deckScripts', () => {
  it('reads the deck and its subdecks, not other decks', () => {
    const notes = [note('Русский', { Entry: 'дорога' }), note('Русский::Глаголы', { Entry: 'забыть' }), note('Ελληνικά', { Entry: 'δρόμος' })];
    expect(deckScripts('Русский', notes)).toEqual(['cyrillic']);
    expect(deckScripts('Ελληνικά', notes)).toEqual(['greek']);
    expect(deckScripts('Рус', notes)).toEqual([]);
  });
  it('is empty for a deck with no notes or only Latin', () => {
    expect(deckScripts('A', [])).toEqual([]);
    expect(deckScripts('A', [note('A', { Entry: 'Straße' })])).toEqual([]);
  });
  it('ignores a script in a few notes, as a Greek letter in a physics deck', () => {
    const notes = Array.from({ length: 50 }, (_, i) => note('Physics', { Front: i < 2 ? 'the angle θ' : 'force' }));
    expect(deckScripts('Physics', notes)).toEqual([]);
    const many = Array.from({ length: 50 }, (_, i) => note('Mixed', { Front: i < 10 ? 'θάλασσα' : 'sea' }));
    expect(deckScripts('Mixed', many)).toEqual(['greek']);
  });
  it('reads a sample of a very large deck', () => {
    const notes = Array.from({ length: 5000 }, () => note('Big', { Entry: 'ทะเล' }));
    expect(deckScripts('Big', notes)).toEqual(['thai']);
  });
});
