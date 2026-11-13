/**
 * WaniKani API resources in the shape revision 20170710 sends (fields per
 * @bachmacintosh/wanikani-api-types 1.8.0), trimmed to what Franki reads.
 */

export const vocabResource = {
  id: 2467,
  object: 'vocabulary',
  url: 'https://api.wanikani.com/v2/subjects/2467',
  data_updated_at: '2026-01-01T00:00:00.000000Z',
  data: {
    level: 3,
    characters: '大人',
    document_url: 'https://www.wanikani.com/vocabulary/大人',
    hidden_at: null,
    meanings: [
      { meaning: 'Adult', primary: true, accepted_answer: true },
      { meaning: 'Grown Up', primary: false, accepted_answer: true },
      { meaning: 'Grownup', primary: false, accepted_answer: false },
    ],
    auxiliary_meanings: [
      { meaning: 'Big Person', type: 'blacklist' },
      { meaning: 'Mature Person', type: 'whitelist' },
    ],
    readings: [{ reading: 'おとな', primary: true, accepted_answer: true }],
    parts_of_speech: ['noun', 'no adjective'],
    component_subject_ids: [453, 440],
    meaning_mnemonic: 'A <kanji>big</kanji> <kanji>person</kanji> is an <vocabulary>adult</vocabulary>.',
    reading_mnemonic: 'This one is an exception: <reading>おとな</reading>.',
    context_sentences: [
      { en: 'I want to be an adult soon.', ja: '早く大人になりたい。' },
      { en: 'Adults only.', ja: '大人のみ。' },
    ],
    pronunciation_audios: [
      { url: 'https://files.wanikani.com/a.webm', content_type: 'audio/webm', metadata: { gender: 'female', voice_actor_id: 1, voice_actor_name: 'Kyoko', pronunciation: 'おとな', source_id: 1, voice_description: '' } },
      { url: 'https://files.wanikani.com/a.mp3', content_type: 'audio/mpeg', metadata: { gender: 'female', voice_actor_id: 1, voice_actor_name: 'Kyoko', pronunciation: 'おとな', source_id: 1, voice_description: '' } },
    ],
    spaced_repetition_system_id: 1,
  },
};

export const kanjiResource = {
  id: 450,
  object: 'kanji',
  data: {
    level: 2,
    characters: '力',
    document_url: 'https://www.wanikani.com/kanji/力',
    hidden_at: null,
    meanings: [
      { meaning: 'Power', primary: true, accepted_answer: true },
      { meaning: 'Strength', primary: false, accepted_answer: true },
    ],
    auxiliary_meanings: [],
    readings: [
      { type: 'onyomi', primary: true, accepted_answer: true, reading: 'りょく' },
      { type: 'onyomi', primary: false, accepted_answer: true, reading: 'りき' },
      { type: 'kunyomi', primary: false, accepted_answer: false, reading: 'ちから' },
    ],
    component_subject_ids: [12],
    meaning_mnemonic: 'The <radical>power</radical> radical is <kanji>power</kanji>.',
    reading_mnemonic: 'Think <reading>りょく</reading>.',
    meaning_hint: 'Strong.',
    reading_hint: null,
    spaced_repetition_system_id: 2,
  },
};

export const radicalResource = {
  id: 8762,
  object: 'radical',
  data: {
    level: 5,
    characters: null,
    document_url: 'https://www.wanikani.com/radicals/gun',
    hidden_at: null,
    meanings: [{ meaning: 'Gun', primary: true, accepted_answer: true }],
    auxiliary_meanings: [],
    character_images: [
      { url: 'https://files.wanikani.com/gun.svg', content_type: 'image/svg+xml', metadata: { inline_styles: true } },
    ],
    meaning_mnemonic: 'A <radical>gun</radical>.',
    spaced_repetition_system_id: 1,
  },
};

export const kanaVocabResource = {
  id: 9001,
  object: 'kana_vocabulary',
  data: {
    level: 1,
    characters: 'ジュース',
    document_url: 'https://www.wanikani.com/vocabulary/ジュース',
    hidden_at: null,
    meanings: [{ meaning: 'Juice', primary: true, accepted_answer: true }],
    auxiliary_meanings: [],
    parts_of_speech: ['noun'],
    meaning_mnemonic: 'Juice.',
    context_sentences: [],
    pronunciation_audios: [],
    spaced_repetition_system_id: 1,
  },
};

/** A radical or kanji as a part of another subject: only what a "Made of" row reads. */
export function partResource(id: number, object: 'radical' | 'kanji', characters: string | null, meaning: string, data: Record<string, unknown> = {}) {
  return {
    id,
    object,
    data: { level: 1, characters, hidden_at: null, meanings: [{ meaning, primary: true, accepted_answer: true }], auxiliary_meanings: [], ...data },
  };
}

export function assignmentResource(id: number, subjectId: number, data: Record<string, unknown> = {}) {
  return {
    id,
    object: 'assignment',
    data: {
      subject_id: subjectId,
      subject_type: 'vocabulary',
      srs_stage: 3,
      available_at: '2026-11-12T10:00:00.000000Z',
      started_at: '2026-11-01T10:00:00.000000Z',
      unlocked_at: '2026-10-31T10:00:00.000000Z',
      passed_at: null,
      burned_at: null,
      hidden: false,
      ...data,
    },
  };
}
