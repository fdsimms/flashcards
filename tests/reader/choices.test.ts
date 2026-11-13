import { describe, expect, it } from 'vitest';
import type { ReaderText, TextChoice, Word } from '../../src/reader/api';
import { choiceText, choicesView, hasChoices, holdsPlayAll } from '../../src/reader/choices';

const word = (text: string, status: Word['status'] = 'known'): Word =>
  ({ text, status, gloss: null, stretch: false, deck: true, grammar: null });

const choice = (english: string, ...parts: string[]): TextChoice => ({ english, words: parts.map((p) => word(p)) });

const episode = (extra: Partial<ReaderText> = {}): ReaderText => ({
  id: 1, topicId: 1, title: 'El faro', coverage: 1, stretch: [], roles: {}, form: 'story', language: 'es', grammar: [], lines: [],
  ...extra,
});

describe('choiceText', () => {
  it('puts the words, spaces and punctuation back together', () => {
    expect(choiceText(choice('Lucía climbs.', 'Lucía', ' ', 'sube', ' ', 'la', ' ', 'escalera', '.'))).toBe('Lucía sube la escalera.');
  });
  it('has no separators to add for a language written without spaces', () => {
    expect(choiceText(choice('I eat.', 'ฉัน', 'กิน'))).toBe('ฉันกิน');
  });
});

describe('choicesView', () => {
  const choices = [choice('Calls Mateo.', 'a'), choice('Waits.', 'b')];

  it('offers the choices to pick from while the episode is being read', () => {
    expect(choicesView(episode({ choices }), false)).toEqual({ pick: true });
    expect(choicesView(episode({ choices, chosen: 1 }), false)).toEqual({ pick: true });
  });
  it('shows a past episode its pick, read-only, and nothing when none was made', () => {
    expect(choicesView(episode({ choices, chosen: 0 }), true)).toEqual({ pick: false });
    expect(choicesView(episode({ choices, chosen: null }), true)).toBeNull();
    expect(choicesView(episode({ choices }), true)).toBeNull();
  });
  it('shows nothing for a text without choices, from an older server or not a story', () => {
    expect(hasChoices(episode())).toBe(false);
    expect(hasChoices(episode({ choices: [] }))).toBe(false);
    expect(choicesView(episode({ choices: [] }), false)).toBeNull();
  });
});

describe('holdsPlayAll', () => {
  const choices = [choice('Calls Mateo.', 'a'), choice('Waits.', 'b')];
  it('stops Play all at an episode that ends on a choice, so it can be made', () => {
    expect(holdsPlayAll(episode({ choices }), false)).toBe(true);
  });
  it('lets Play all move on from any other text', () => {
    expect(holdsPlayAll(episode(), false)).toBe(false);
    expect(holdsPlayAll(episode({ choices }), true)).toBe(false);
  });
});
