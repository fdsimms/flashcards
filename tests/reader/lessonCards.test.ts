import { describe, expect, it } from 'vitest';
import { firstChosen, hasClips, lessonClipName, lessonPhraseNote, NO_CLIP_NOTE, phrasesToOffer } from '../../src/reader/lessonCards';
import { entryKeys } from '../../src/reader/newWords';

const LESSON = {
  phrases: [
    { text: "Un café, s'il vous plaît.", english: 'A coffee, please.' },
    { text: "S'il vous plaît.", english: 'Please.' },
  ],
};

describe('phrasesToOffer', () => {
  it('marks the phrases the deck already has, and chooses the rest', () => {
    const offered = phrasesToOffer(LESSON, entryKeys(["s'il vous plaît."]));
    expect(offered.map((p) => p.inDeck)).toEqual([false, true]);
    expect([...firstChosen(offered)]).toEqual([0]);
  });
});

describe('lessonPhraseNote', () => {
  it("starts with the phrase, its meaning and the lesson's recording", () => {
    const note = lessonPhraseNote(LESSON.phrases[0], 'French::Phrases', 'fr', 'franki-lesson-abc.mp3');
    expect(note.deck).toBe('French::Phrases');
    expect(note.model).toBe('Omnilanguage');
    expect(note.fields).toMatchObject({ Entry: "Un café, s'il vous plaît.", Meaning: 'A coffee, please.', Audio: '[sound:franki-lesson-abc.mp3]' });
  });

  it('says under Audio why there is no recording', () => {
    const note = lessonPhraseNote(LESSON.phrases[1], 'French', 'fr', null);
    expect(note.fields.Audio).toBeUndefined();
    expect(note.fieldNotes?.Audio).toBe(NO_CLIP_NOTE);
  });
});

describe('lessonClipName', () => {
  it('names a clip by its bytes', () => {
    const a = lessonClipName(new Uint8Array([1, 2, 3]));
    expect(a).toMatch(/^franki-lesson-[0-9a-f]{16}\.mp3$/);
    expect(lessonClipName(new Uint8Array([1, 2, 3]))).toBe(a);
    expect(lessonClipName(new Uint8Array([3, 2, 1]))).not.toBe(a);
  });
});

describe('hasClips', () => {
  it('is only for a lesson with a transcript', () => {
    expect(hasClips({ script: [] })).toBe(true);
    expect(hasClips({ script: null })).toBe(false);
    expect(hasClips({})).toBe(false);
  });
});
