import { describe, expect, it } from 'vitest';
import { dropWord, heldCounts, holdWords, parseHeldWords, type HeldWords } from '../../src/reader/heldNotes';

describe('held words', () => {
  it("adds to a deck's waiting words, a word already there held once", () => {
    let list = holdWords([], 'pl', 'Polski', [{ entry: 'kot', meaning: 'cat' }]);
    list = holdWords(list, 'pl', 'Polski', [{ entry: 'kot', meaning: 'cat' }, { entry: 'pies', meaning: '' }]);
    list = holdWords(list, 'de', 'Deutsch', [{ entry: 'Hund', meaning: '' }]);
    expect(list).toEqual([
      { language: 'pl', deck: 'Polski', entries: [{ entry: 'kot', meaning: 'cat' }, { entry: 'pies', meaning: '' }] },
      { language: 'de', deck: 'Deutsch', entries: [{ entry: 'Hund', meaning: '' }] },
    ]);
  });

  it('keeps refused words apart from new ones, and counts both', () => {
    const refused: HeldWords = { language: 'pl', deck: 'Polski', entries: [{ entry: 'kot', meaning: '' }], problem: 'No Claude key.' };
    const list = holdWords([refused], 'pl', 'Polski', [{ entry: 'pies', meaning: '' }]);
    expect(list).toHaveLength(2);
    expect(heldCounts(list)).toEqual({ waiting: 1, refused: 1 });
  });

  it('removes a word, and a deck left with none', () => {
    const list = holdWords([], 'pl', 'Polski', [{ entry: 'kot', meaning: '' }]);
    expect(dropWord(list, 'Polski', 'kot')).toEqual([]);
  });

  it('reads back only what it wrote', () => {
    expect(parseHeldWords([{ language: 'pl', deck: 'P', entries: [{ entry: 'kot', meaning: '' }] }, { deck: 'x' }])).toHaveLength(1);
    expect(parseHeldWords(null)).toEqual([]);
  });
});
