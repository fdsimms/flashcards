import { describe, expect, it } from 'vitest';
import { parseSubject } from '../../src/wanikani/subjects';
import { buildWritingKanji, kanjiItems, parseWritingKanji, writingKanjiStale } from '../../src/wanikani/writingKanji';
import { kanjiResource, vocabResource } from './fixtures';

const kanji = parseSubject(kanjiResource)!; // 力, level 2
const vocab = parseSubject(vocabResource)!;
const NOW = new Date(2026, 10, 27, 12);

describe('the kanji Writing by hand asks for', () => {
  const data = buildWritingKanji([kanji, vocab], 2, NOW);

  it('keeps each kanji in the levels reached, with its main meaning and reading', () => {
    expect(data.kanji).toEqual([['力', 'Power', 'りょく']]);
    expect(buildWritingKanji([kanji], 1, NOW).kanji).toEqual([]);
  });

  it('leaves out a kanji with no meaning or no reading, and puts the rest in lesson order', () => {
    const second = { ...kanji, id: 451, characters: '口', level: 1, lessonPosition: 3 };
    const first = { ...kanji, id: 452, characters: '入', level: 1, lessonPosition: 1 };
    const built = buildWritingKanji([kanji, { ...kanji, id: 453, characters: '七', readings: [] }, second, first], 5, NOW);
    expect(built.kanji.map((k) => k[0])).toEqual(['入', '口', '力']);
  });

  it('asks by the meaning, with the reading under it and read aloud', () => {
    expect(kanjiItems(data)).toEqual([{ text: '力', prompt: 'Power', detail: 'りょく', say: 'りょく', patterns: ['kanji:力'] }]);
  });

  it('is read again on a new study day or at a new level, and reads back what it wrote', () => {
    expect(writingKanjiStale(data, 2, new Date(2026, 10, 27, 23), 4)).toBe(false);
    expect(writingKanjiStale(data, 2, new Date(2026, 10, 28, 3), 4)).toBe(false);
    expect(writingKanjiStale(data, 2, new Date(2026, 10, 28, 5), 4)).toBe(true);
    expect(writingKanjiStale(data, 3, NOW, 4)).toBe(true);
    expect(writingKanjiStale(null, 2, NOW, 4)).toBe(true);
    expect(parseWritingKanji(JSON.stringify(data))).toEqual(data);
    expect(parseWritingKanji('{"version":1,"savedAt":"x","level":2,"kanji":[["力","Power"]]}')).toBeNull();
    expect(parseWritingKanji('{"version":2}')).toBeNull();
    expect(parseWritingKanji('nonsense')).toBeNull();
  });
});
