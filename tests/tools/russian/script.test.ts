import { describe, expect, it } from 'vitest';
import { RUSSIAN_SCRIPT as ru } from '../../../src/tools/russian/script';

const find = (shown: string) => ru.words.findIndex((w) => w.shown === shown);

describe('reading Russian aloud', () => {
  it('shows the word as written, and marks its stress in the answer', () => {
    const w = ru.words[find('молоко')];
    expect(w.answer.text).toBe('молоко́');
    expect(w.answer.roman).toBe('molokó');
    expect(ru.words.every((x) => !x.shown.includes('́'))).toBe(true);
  });

  it('marks exactly one stress on every word', () => {
    for (const w of ru.words) {
      const marks = (w.answer.text.match(/́/g) ?? []).length + (w.answer.text.match(/ё/g) ?? []).length;
      expect(marks, w.answer.text).toBe(1);
    }
  });

  it('says where the stress is, and what it does to the other vowels', () => {
    expect(ru.rule(find('молоко'))).toBe('The stress is on о: молоко́. An unstressed о sounds like а.');
    expect(ru.rule(find('ребёнок'))).toContain('An unstressed е or я sounds close to и.');
    expect(ru.rule(find('рыба'))).toBe('The stress is on ы: ры́ба.');
    expect(ru.patterns(find('молоко'))).toEqual(['reduced:o']);
  });
});
