import { describe, expect, it } from 'vitest';
import { buildKanjiLevels, kanjiLevelsStale, levelsOf, parseKanjiLevels } from '../../src/wanikani/kanjiLevels';
import { parseSubject } from '../../src/wanikani/subjects';
import { kanjiResource, vocabResource } from './fixtures';

const kanji = parseSubject(kanjiResource)!; // 力
const vocab = parseSubject(vocabResource)!;
const NOW = new Date(2026, 10, 17, 12);

describe('kanji levels from WaniKani', () => {
  const data = buildKanjiLevels([kanji, vocab], NOW);
  it('keeps the level of each kanji and nothing else', () => {
    expect(data.levels).toEqual([['力', kanji.level]]);
    expect(levelsOf(data).get('力')).toBe(kanji.level);
    expect(levelsOf(data).get('大')).toBeUndefined();
  });
  it('is read again on a new study day, and reads back what it wrote', () => {
    expect(kanjiLevelsStale(data, new Date(2026, 10, 17, 23), 4)).toBe(false);
    expect(kanjiLevelsStale(data, new Date(2026, 10, 18, 5), 4)).toBe(true);
    expect(kanjiLevelsStale(null, NOW, 4)).toBe(true);
    expect(parseKanjiLevels(JSON.stringify(data))).toEqual(data);
    expect(parseKanjiLevels('{"version":2}')).toBeNull();
    expect(parseKanjiLevels('nonsense')).toBeNull();
  });
});
