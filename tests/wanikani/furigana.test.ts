import { describe, expect, it } from 'vitest';
import { furiganaRuns } from '../../src/core/furigana';
import { buildFuriganaData, furiganaStale, kanjiReadingsOf, learnedOf, parseFuriganaData, vocabularyIds } from '../../src/wanikani/furigana';
import { parseSubject, type Assignment } from '../../src/wanikani/subjects';
import { kanaVocabResource, kanjiResource, vocabResource } from './fixtures';

const kanji = parseSubject(kanjiResource)!; // 力: りょく, りき, ちから
const vocab = parseSubject(vocabResource)!; // 大人
const kana = parseSubject(kanaVocabResource)!;
const assignment = (subjectId: number, subjectType: Assignment['subjectType']): Assignment =>
  ({ id: subjectId, subjectId, subjectType, srsStage: 5, availableAt: null, startedAt: null, unlockedAt: null, passedAt: null, hidden: false });
const passed = [assignment(kanji.id, 'kanji'), assignment(vocab.id, 'vocabulary'), assignment(kana.id, 'kana_vocabulary')];
const NOW = new Date(2026, 10, 17, 12);

describe('furigana data from WaniKani', () => {
  const data = buildFuriganaData([kanji], passed, [vocab, kana], NOW);
  it('keeps every kanji with its readings, and what is learned', () => {
    expect(data.kanji).toEqual([['力', ['りょく', 'りき', 'ちから']]]);
    expect(learnedOf(data).kanji).toEqual(new Set(['力']));
    expect(learnedOf(data).vocabulary).toEqual(new Set(['大人', kana.characters]));
    expect(kanjiReadingsOf(data)('力')).toEqual(['りょく', 'りき', 'ちから']);
  });
  it('asks only for the vocabulary subjects, since every kanji is read already', () => {
    expect(vocabularyIds(passed)).toEqual([vocab.id, kana.id]);
  });
  it('splits a word by the kanji readings it keeps', () => {
    expect(furiganaRuns('力力', 'ちからりょく', kanjiReadingsOf(data))).toEqual([{ text: '力', ruby: 'ちから' }, { text: '力', ruby: 'りょく' }]);
  });
  it('is read again on a new study day, and reads back what it wrote', () => {
    expect(furiganaStale(data, new Date(2026, 10, 17, 23), 4)).toBe(false);
    expect(furiganaStale(data, new Date(2026, 10, 18, 5), 4)).toBe(true);
    expect(furiganaStale(null, NOW, 4)).toBe(true);
    expect(parseFuriganaData(JSON.stringify(data))).toEqual(data);
    expect(parseFuriganaData('{"version":2}')).toBeNull();
    expect(parseFuriganaData('nonsense')).toBeNull();
  });
});
