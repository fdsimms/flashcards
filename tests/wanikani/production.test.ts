import { describe, expect, it } from 'vitest';
import { cardKindsFor } from '../../src/core/cards';
import { audioFileName, audioFor, productionFields, productionNeeded, productionTags, subjectOfNote, suggestedDeck } from '../../src/wanikani/production';
import { parseAssignment, parseSubject } from '../../src/wanikani/subjects';
import { assignmentResource, kanaVocabResource, vocabResource } from './fixtures';

const vocab = parseSubject(vocabResource)!;

describe('which words need a production card', () => {
  const passed = [
    assignmentResource(1, 10, { srs_stage: 5, passed_at: '2026-11-03T00:00:00Z' }),
    assignmentResource(2, 20, { srs_stage: 7, passed_at: '2026-10-01T00:00:00Z' }),
    assignmentResource(3, 30, { srs_stage: 4, passed_at: null }),
    assignmentResource(4, 40, { srs_stage: 6, subject_type: 'kanji' }),
    assignmentResource(5, 50, { srs_stage: 9, subject_type: 'kana_vocabulary', passed_at: '2026-10-05T00:00:00Z' }),
  ].map((r) => parseAssignment(r)!);

  it('takes vocabulary at Guru or above, the earliest to pass first', () => {
    expect(productionNeeded(passed, [], new Set(), 10).map((a) => a.subjectId)).toEqual([20, 50, 10]);
  });

  it("skips a word that has a note, or had one that was deleted", () => {
    const notes = [{ tags: ['wanikani', 'wanikani::20'] }];
    expect(productionNeeded(passed, notes, new Set([50]), 10).map((a) => a.subjectId)).toEqual([10]);
  });

  it('stops at the limit', () => {
    expect(productionNeeded(passed, [], new Set(), 1).map((a) => a.subjectId)).toEqual([20]);
  });

  it('finds the subject in a tag', () => {
    expect(subjectOfNote({ tags: productionTags(2467) })).toBe(2467);
    expect(subjectOfNote({ tags: ['wanikani'] })).toBeUndefined();
  });
});

describe('the note', () => {
  it('asks by meaning, answers with the word, its reading, a sentence and the recording', () => {
    const audio = audioFor(vocab)!;
    expect(audio.url).toBe('https://files.wanikani.com/a.mp3');
    const file = audioFileName(vocab.id, audio);
    expect(file).toBe('wanikani-2467-1.mp3');
    expect(productionFields(vocab, file)).toEqual({
      Entry: '大人',
      Meaning: 'Adult, Grown Up',
      KanaReading: 'おとな',
      Context: '早く大人になりたい。',
      ContextTranslation: 'I want to be an adult soon.',
      PartOfSpeech: 'noun, no adjective',
      Audio: '[sound:wanikani-2467-1.mp3]',
      Language: 'Japanese',
      SuppressFrontCard: 'y',
      GenerateReverse: 'y',
    });
  });

  it('makes only the Reverse card', () => {
    const note = { id: 'n', deck: 'd', model: 'Omnilanguage', tags: [], fields: { ...productionFields(vocab), Entry: '大人' } };
    expect(cardKindsFor(note)).toEqual(['reverse']);
  });

  it('leaves out the reading of a kana-only word', () => {
    const fields = productionFields(parseSubject(kanaVocabResource)!);
    expect(fields.KanaReading).toBeUndefined();
    expect(fields.Entry).toBe('ジュース');
  });
});

describe('the deck', () => {
  it('suggests the deck named Japanese', () => {
    expect(suggestedDeck(['👅 Languages', '👅 Languages::🍥 日本語', '👅 Languages::💈 Polski'])).toBe('👅 Languages::🍥 日本語');
    expect(suggestedDeck(['Japanese::Grammar'])).toBeUndefined();
    expect(suggestedDeck(['Polski'])).toBeUndefined();
  });
});
