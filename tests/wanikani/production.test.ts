import { describe, expect, it } from 'vitest';
import { cardKindsFor } from '../../src/core/cards';
import { audioFileName, audioFor, lowerGloss, partOfSpeech, productionFields, productionNeeded, productionTags, sensesAsked, subjectOfNote, suggestedDeck } from '../../src/wanikani/production';
import { parseAssignment, parseSubject } from '../../src/wanikani/subjects';
import { assignmentResource, kanaVocabResource, vocabResource } from './fixtures';

const vocab = parseSubject(vocabResource)!;
const moon = {
  ...vocab,
  id: 2542,
  characters: '月',
  meanings: [
    { meaning: 'Moon', primary: true, accepted: true },
    { meaning: 'Month', primary: false, accepted: true },
  ],
  contextSentences: [
    { ja: '月がきれいだ。', en: 'The moon is pretty.' },
    { ja: '来月<行く>。', en: 'I go next month & more.' },
  ],
};

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
      Meaning: 'adult; grown up',
      KanaReading: 'おとな',
      Context: '早く<b>大人</b>になりたい。',
      ContextTranslation: 'I want to be an adult soon.',
      PartOfSpeech: 'noun',
      Register: 'neutral',
      Audio: '[sound:wanikani-2467-1.mp3]',
      Language: 'Japanese',
      SuppressFrontCard: 'y',
      GenerateReverse: 'y',
    });
  });

  it('lowercases WaniKani\'s Title Case glosses but keeps proper nouns', () => {
    expect(lowerGloss('To Be Born')).toBe('to be born');
    expect(lowerGloss('One Machine')).toBe('one machine');
    expect(lowerGloss('Under The Bed')).toBe('under the bed');
    expect(lowerGloss('October')).toBe('October');
    expect(lowerGloss('Mt. Fuji')).toBe('Mt. Fuji');
    expect(lowerGloss('American person')).toBe('American person');
    expect(lowerGloss('Frenchman')).toBe('Frenchman');
    expect(lowerGloss('Brit')).toBe('Brit');
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

describe('a word with different senses', () => {
  const senses = { glosses: [[0], [1]], sentences: [0, 1], labels: ['moon', 'month'] };

  it('asks the server about a word with two or more glosses, as the Meaning would list them', () => {
    expect(sensesAsked(moon)).toEqual({ id: 2542, characters: '月', glosses: ['moon', 'month'], sentences: moon.contextSentences });
    expect(sensesAsked({ ...vocab, meanings: [vocab.meanings[0]] })).toBeUndefined();
  });

  it('numbers the senses, one to a line, each with its own sentence and label', () => {
    const fields = productionFields(moon, undefined, senses);
    expect(fields.Meaning).toBe('1. moon<br>2. month');
    expect(fields.Context).toBe('<b>月</b>がきれいだ。<br>来<b>月</b>&lt;行く&gt;。');
    expect(fields.ContextTranslation).toBe('The moon is pretty.<br>I go next month &amp; more.');
    expect(fields.ContextLabels).toBe('moon<br>month');
  });

  it('keeps glosses of one sense on its line, in the order sorted', () => {
    const three = { ...moon, meanings: [...moon.meanings, { meaning: 'Lunar Month', primary: false, accepted: true }] };
    expect(productionFields(three, undefined, { glosses: [[1, 2], [0]], sentences: [1, 0], labels: ['month', 'moon'] }).Meaning)
      .toBe('1. month; lunar month<br>2. moon');
  });

  it("writes one line of glosses when the senses don't fit the word", () => {
    for (const bad of [
      { ...senses, glosses: [[0, 1]], sentences: [0], labels: ['moon'] },
      { ...senses, glosses: [[0], [0]] },
      { ...senses, glosses: [[0], [1], []], sentences: [0, 1, 0], labels: ['a', 'b', 'c'] },
      { ...senses, sentences: [0, 0] },
      { ...senses, sentences: [0, 5] },
      { ...senses, labels: ['moon', ' '] },
    ]) {
      const fields = productionFields(moon, undefined, bad);
      expect(fields.Meaning).toBe('moon; month');
      expect(fields.Context).toBe('<b>月</b>がきれいだ。');
      expect(fields.ContextLabels).toBeUndefined();
    }
  });
});

describe('the house style', () => {
  it("names the part of speech from the house list, the first of WaniKani's it has, and a verb's class", () => {
    expect(partOfSpeech(['transitive verb', 'ichidan verb'])).toEqual({ PartOfSpeech: 'verb', VerbClass: 'ichidan' });
    expect(partOfSpeech(['intransitive verb', 'godan verb'])).toEqual({ PartOfSpeech: 'verb', VerbClass: 'godan' });
    expect(partOfSpeech(['い adjective'])).toEqual({ PartOfSpeech: 'adjective' });
    expect(partOfSpeech(['noun', 'の adjective'])).toEqual({ PartOfSpeech: 'noun' });
    expect(partOfSpeech(['noun', 'する verb'])).toEqual({ PartOfSpeech: 'noun' });
    expect(partOfSpeech(['counter'])).toEqual({ PartOfSpeech: 'classifier' });
    expect(partOfSpeech(['expression'])).toEqual({ PartOfSpeech: 'phrase' });
    expect(partOfSpeech(['adverb'])).toEqual({ PartOfSpeech: 'adverb' });
    expect(partOfSpeech(['something new'])).toEqual({});
    expect(partOfSpeech([])).toEqual({});
  });

  it("bolds the word only where the sentence writes it as the word is", () => {
    expect(productionFields({ ...moon, characters: '〜月' }).Context).toBe('<b>月</b>がきれいだ。');
    const verb = { ...vocab, characters: '食べる', contextSentences: [{ ja: 'パンを食べた。', en: 'I ate bread.' }] };
    expect(productionFields(verb).Context).toBe('パンを食べた。');
  });
});
