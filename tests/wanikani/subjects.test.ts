import { describe, expect, it } from 'vitest';
import { asksReading, mnemonicParts, otherMeanings, parseAssignment, parseSubject, primaryMeaning, primaryReading, readingGroups } from '../../src/wanikani/subjects';
import { assignmentResource, kanaVocabResource, kanjiResource, radicalResource, vocabResource } from './fixtures';

describe('reading subjects', () => {
  it('reads a vocabulary item with its meanings, readings, sentences and recordings', () => {
    const s = parseSubject(vocabResource)!;
    expect(s).toMatchObject({ id: 2467, type: 'vocabulary', level: 3, characters: '大人', srsId: 1, hidden: false });
    expect(primaryMeaning(s)).toBe('Adult');
    expect(otherMeanings(s)).toEqual(['Grown Up']);
    expect(primaryReading(s)).toBe('おとな');
    expect(s.auxiliaryMeanings).toEqual([{ meaning: 'Big Person', type: 'blacklist' }, { meaning: 'Mature Person', type: 'whitelist' }]);
    expect(s.contextSentences[0]).toEqual({ en: 'I want to be an adult soon.', ja: '早く大人になりたい。' });
    expect(s.audio.map((a) => a.contentType)).toEqual(['audio/webm', 'audio/mpeg']);
    expect(s.componentIds).toEqual([453, 440]);
    expect(asksReading(s)).toBe(true);
  });

  it("groups a kanji's readings by type, the type WaniKani teaches first", () => {
    const s = parseSubject(kanjiResource)!;
    expect(readingGroups(s)).toEqual([
      { type: 'onyomi', readings: ['りょく', 'りき'], primary: true },
      { type: 'kunyomi', readings: ['ちから'], primary: false },
    ]);
    expect(s.meaningHint).toBe('Strong.');
    expect(s.readingHint).toBeUndefined();
  });

  it('draws a radical with no characters from its image, and asks no reading', () => {
    const s = parseSubject(radicalResource)!;
    expect(s.characters).toBeNull();
    expect(s.image).toEqual({ url: 'https://files.wanikani.com/gun.svg', svg: true });
    expect(asksReading(s)).toBe(false);
  });

  it('asks a kana-only word its meaning only', () => {
    const s = parseSubject(kanaVocabResource)!;
    expect(s.type).toBe('kana_vocabulary');
    expect(asksReading(s)).toBe(false);
    expect(readingGroups(s)).toEqual([]);
  });

  it('drops what is not a subject', () => {
    expect(parseSubject(null)).toBeNull();
    expect(parseSubject({ id: 1, object: 'assignment', data: {} })).toBeNull();
    expect(parseSubject({ ...vocabResource, data: { ...vocabResource.data, meanings: [] } })).toBeNull();
  });

  it('reads an assignment', () => {
    expect(parseAssignment(assignmentResource(7, 2467, { srs_stage: 5, passed_at: '2026-11-10T00:00:00Z' }))).toEqual({
      id: 7, subjectId: 2467, subjectType: 'vocabulary', srsStage: 5,
      availableAt: '2026-11-12T10:00:00.000000Z', startedAt: '2026-11-01T10:00:00.000000Z',
      unlockedAt: '2026-10-31T10:00:00.000000Z', passedAt: '2026-11-10T00:00:00Z', hidden: false,
    });
    expect(parseAssignment({ id: 1, data: { subject_type: 'nope', subject_id: 1, srs_stage: 1 } })).toBeNull();
  });
});

describe('mnemonics', () => {
  it('splits out the marked-up words', () => {
    expect(mnemonicParts('A <kanji>big</kanji> <kanji>person</kanji> is an <vocabulary>adult</vocabulary>.')).toEqual([
      { text: 'A ' }, { text: 'big', mark: 'kanji' }, { text: ' ' }, { text: 'person', mark: 'kanji' },
      { text: ' is an ' }, { text: 'adult', mark: 'vocabulary' }, { text: '.' },
    ]);
  });

  it('drops tags it does not know', () => {
    expect(mnemonicParts('<i>Very</i> <reading>おとな</reading>')).toEqual([{ text: 'Very ' }, { text: 'おとな', mark: 'reading' }]);
  });
});
