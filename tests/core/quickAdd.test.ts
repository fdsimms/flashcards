import { describe, expect, it } from 'vitest';
import { addWord, asTyped, counts, inLatinLetters, parseWordList, splitLine, wordState } from '../../src/core/quickAdd';

describe('splitLine and parseWordList', () => {
  it('takes one word or phrase per line and skips blank lines', () => {
    expect(parseWordList('ricane\n\n  se méfier  \n').words).toEqual([
      { entry: 'ricane', meaning: '' },
      { entry: 'se méfier', meaning: '' },
    ]);
    expect(splitLine('   ')).toBeNull();
  });

  it("takes the owner's meaning after a spaced dash or a tab", () => {
    expect(parseWordList('bouder - to sulk\nricane – sniggers\nse méfier — to distrust\nodpuścić\tto let go').words).toEqual([
      { entry: 'bouder', meaning: 'to sulk' },
      { entry: 'ricane', meaning: 'sniggers' },
      { entry: 'se méfier', meaning: 'to distrust' },
      { entry: 'odpuścić', meaning: 'to let go' },
    ]);
  });

  it('keeps a hyphen inside a word and a dash inside the meaning', () => {
    expect(splitLine('peut-être')).toEqual({ entry: 'peut-être', meaning: '' });
    expect(splitLine('bouder - to sulk - pout')?.meaning).toBe('to sulk - pout');
  });

  it('counts a repeated line instead of dropping it silently', () => {
    const { words, repeated } = parseWordList('ricane\nbouder\nricane - sniggers\n');
    expect(words.map((e) => e.entry)).toEqual(['ricane', 'bouder']);
    expect(repeated).toBe(1);
  });

  it('reads Windows line endings and an empty box', () => {
    expect(parseWordList('a\r\nb').words).toHaveLength(2);
    expect(parseWordList('  \n ')).toEqual({ words: [], repeated: 0 });
  });
});

describe('addWord', () => {
  it('puts the newest word on top and replaces the same word typed again', () => {
    const list = addWord(addWord([], { entry: 'стол', meaning: '' }), { entry: 'кот', meaning: '' });
    expect(list.map((w) => w.entry)).toEqual(['кот', 'стол']);
    expect(addWord(list, { entry: 'стол', meaning: 'table' })).toEqual([{ entry: 'стол', meaning: 'table' }, { entry: 'кот', meaning: '' }]);
  });
});

describe('inLatinLetters', () => {
  it('finds a word typed in Latin letters for a language with its own script', () => {
    expect(inLatinLetters('torgovatsya', 'ru-RU')).toBe(true);
    expect(inLatinLetters("byt'", 'ru-RU')).toBe(true);
    expect(inLatinLetters('sawatdee khrap', 'th-TH')).toBe(true);
    expect(inLatinLetters('taberu', 'ja-JP')).toBe(true);
  });

  it('leaves a word in its own script, a mixed one, and Latin-script languages alone', () => {
    expect(inLatinLetters('торговаться', 'ru-RU')).toBe(false);
    expect(inLatinLetters('SMS-ка', 'ru-RU')).toBe(false);
    expect(inLatinLetters('zrodlo', 'pl-PL')).toBe(false);
    expect(inLatinLetters('word', 'en-US')).toBe(false);
    expect(inLatinLetters('word', undefined)).toBe(false);
    expect(inLatinLetters('123', 'ru-RU')).toBe(false);
  });
});

describe('asTyped', () => {
  it('turns romaji into kana for a Japanese deck, the trailing n once the word is added', () => {
    expect(asTyped('taberu', 'ja-JP')).toBe('たべる');
    expect(asTyped('hon', 'ja-JP')).toBe('ほn');
    expect(asTyped('hon', 'ja-JP', true)).toBe('ほん');
  });

  it('leaves other languages and kana as typed', () => {
    expect(asTyped('torgovatsya', 'ru-RU')).toBe('torgovatsya');
    expect(asTyped('たべる', 'ja-JP')).toBe('たべる');
  });
});

describe('wordState', () => {
  const ru = 'ru-RU';

  it('with Claude: a word is added, one in Latin letters is spelled, one in the deck waits for Add anyway', () => {
    expect(wordState({ entry: 'огурец', meaning: '' }, { filled: true, speechTag: ru })).toBe('add');
    expect(wordState({ entry: 'ogurets', meaning: '' }, { filled: true, speechTag: ru })).toBe('spell');
    expect(wordState({ entry: 'стол', meaning: '' }, { filled: true, speechTag: ru, inDeck: 'Русский' })).toBe('inDeck');
    expect(wordState({ entry: 'стол', meaning: '', anyway: true }, { filled: true, speechTag: ru, inDeck: 'Русский' })).toBe('add');
  });

  it('without Claude: a word needs its meaning and its own script', () => {
    expect(wordState({ entry: 'огурец', meaning: '' }, { filled: false, speechTag: ru })).toBe('needsMeaning');
    expect(wordState({ entry: 'ogurets', meaning: 'cucumber' }, { filled: false, speechTag: ru })).toBe('needsScript');
    expect(wordState({ entry: 'огурец', meaning: 'cucumber' }, { filled: false, speechTag: ru })).toBe('add');
    expect(wordState({ entry: 'Capital of Peru', meaning: 'Lima' }, { filled: false })).toBe('add');
  });

  it('counts only what will be added', () => {
    expect([counts('add'), counts('spell'), counts('inDeck'), counts('needsMeaning'), counts('needsScript')]).toEqual([true, true, false, false, false]);
  });
});
