import { describe, expect, it } from 'vitest';
import { SCRIPTS, WRITING } from '../../src/tools/tools';
import { wordItems, writingHint, writingKind, writingKinds, writingStyle, type WritingItem } from '../../src/tools/writing';

const KANJI: WritingItem[] = [{ text: '力', prompt: 'Power', detail: 'りょく', say: 'りょく', patterns: ['kanji:力'] }];

describe('what Writing by hand asks for', () => {
  for (const [language, writing] of Object.entries(WRITING)) {
    it(`gives every ${language} letter and word something to show, to say and to write, each once`, () => {
      for (const list of [writing.letters, writing.words]) {
        expect(list.length).toBeGreaterThan(0);
        for (const item of list) {
          expect(item.text.trim(), item.prompt).not.toBe('');
          expect(item.prompt.trim(), item.text).not.toBe('');
          expect(item.say.trim(), item.text).not.toBe('');
          expect(item.patterns.length, item.text).toBeGreaterThan(0);
          // The question never shows what's to be written.
          expect(item.prompt, item.text).not.toContain(item.text);
        }
        expect(new Set(list.map((i) => i.text)).size).toBe(list.length);
      }
    });
  }

  it('has the letters of each script', () => {
    // 44 consonants less the two no longer used, and the vowels.
    expect(WRITING.th!.letters.filter((l) => l.text.length === 1)).toHaveLength(42);
    expect(WRITING.th!.letters.map((l) => l.text)).not.toContain('ฃ');
    expect(WRITING.ru!.letters).toHaveLength(33);
    expect(WRITING.ru!.letters[1]).toMatchObject({ text: 'Б б', prompt: 'be', say: 'б' });
    expect(WRITING.el!.letters).toHaveLength(24);
    expect(WRITING.el!.letters.find((l) => l.prompt === 'sigma')!.text).toBe('Σ σ ς');
    expect(WRITING.ja!.letters).toHaveLength(142);
    // No two kana of one script are asked for the same way.
    expect(new Set(WRITING.ja!.letters.map((l) => `${l.prompt}|${l.detail}`)).size).toBe(142);
  });

  it('asks for katakana by the same sounds as hiragana', () => {
    const kana = WRITING.ja!.letters;
    expect(kana.find((k) => k.text === 'し')).toMatchObject({ prompt: 'shi', detail: 'Hiragana' });
    expect(kana.find((k) => k.text === 'シ')).toMatchObject({ prompt: 'shi', detail: 'Katakana' });
    expect(kana.find((k) => k.text === 'ン')).toMatchObject({ prompt: 'n', detail: 'Katakana' });
    expect(kana.find((k) => k.text === 'ヅ')).toMatchObject({ prompt: 'zu (on tsu)', detail: 'Katakana' });
  });

  it('tells Thai vowels that sound alike apart by a word', () => {
    const ai = WRITING.th!.letters.filter((l) => l.prompt === 'gai');
    expect(ai.map((l) => l.text)).toEqual(['ไก', 'ใก']);
    expect(ai[0].detail).not.toBe(ai[1].detail);
  });

  it("asks for Reading the script's words by sound and meaning", () => {
    expect(wordItems(SCRIPTS.th!)[0]).toEqual({ text: 'กา', prompt: 'gaa', detail: 'crow', say: 'กา', patterns: ['word:กา'] });
    // Russian is written without the stress mark its answer carries.
    expect(wordItems(SCRIPTS.ru!)[0].text).toBe('молоко');
    expect(wordItems({ words: [{ shown: 'x', meaning: 'a thing', answer: { text: 'x' } }], rule: () => undefined, patterns: () => [] })[0])
      .toEqual({ text: 'x', prompt: 'a thing', say: 'x', patterns: ['word:x'] });
  });

  it('offers kanji only once there are some', () => {
    expect(writingKinds(WRITING.ja!, [])).toEqual(['letters', 'words']);
    expect(writingKinds(WRITING.ja!, KANJI)).toEqual(['letters', 'words', 'kanji']);
    expect(writingKinds({ letters: [], words: [] }, [])).toEqual([]);
  });

  it('practices the saved kind where there is one, else the first', () => {
    expect(writingKind('kanji', ['letters', 'words', 'kanji'])).toBe('kanji');
    expect(writingKind('kanji', ['letters', 'words'])).toBe('letters');
    expect(writingKind('letters', [])).toBeUndefined();
  });

  it('writes in cursive only where the language has it', () => {
    expect(writingStyle('cursive', 'ru')).toBe('cursive');
    expect(writingStyle('printed', 'ru')).toBe('printed');
    expect(writingStyle('cursive', 'th')).toBe('printed');
    expect(writingStyle('cursive', 'ja')).toBe('printed');
  });

  it('says what to do under the box', () => {
    expect(writingHint('letters', 'trace', false)).toBe('Trace the letter');
    expect(writingHint('words', 'memory', false)).toBe('Write the word');
    expect(writingHint('kanji', 'memory', false)).toBe('Write the kanji');
    expect(writingHint('kanji', 'trace', true)).toBe('Compare with the kanji');
  });
});
