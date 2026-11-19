// Adding an audio lesson's phrases to the deck (docs/read-and-listen/architecture.md, Audio lessons):
// which to offer, and the note each starts as in the note editor, with the phrase's recording cut from
// the lesson. Saving in the editor is the approval; nothing here writes a note. Pure, so it's tested.
import { sha1Hex } from '../anki/sha1';
import type { AudioLesson, Language } from './api';
import { minedNote, type MinedNote } from './mining';
import { inDeck } from './newWords';

export type OfferedPhrase = { index: number; text: string; english: string; inDeck: boolean };

/** The lesson's phrases, each saying whether the deck already has it (`entries`, newWords.entryKeys). */
export function phrasesToOffer(lesson: Pick<AudioLesson, 'phrases'>, entries: ReadonlySet<string>): OfferedPhrase[] {
  return lesson.phrases.map((p, index) => ({ index, text: p.text, english: p.english, inDeck: inDeck(p.text, entries) }));
}

/** Chosen to start with: every phrase the deck doesn't have yet. */
export function firstChosen(offered: readonly OfferedPhrase[]): Set<number> {
  return new Set(offered.filter((p) => !p.inDeck).map((p) => p.index));
}

/** The media file a phrase's recording is kept in, named by its bytes so the same clip is one file. */
export function lessonClipName(bytes: Uint8Array): string {
  return `franki-lesson-${sha1Hex(bytes).slice(0, 16)}.mp3`;
}

/** What the note editor says under Audio when the lesson's recording couldn't be had. */
export const NO_CLIP_NOTE = "The lesson's recording of this phrase couldn't be fetched. Record it from the note later.";

/**
 * The note a phrase starts as: it and its meaning in the language's deck, with the lesson's recording
 * in Audio as Anki keeps it, or a note under Audio saying why there's none.
 */
export function lessonPhraseNote(phrase: { text: string; english: string }, deck: string, language: Language, audio: string | null): MinedNote {
  const note = minedNote(phrase.text, phrase.english, deck, undefined, null, language);
  return audio
    ? { ...note, fields: { ...note.fields, Audio: `[sound:${audio}]` } }
    : { ...note, fieldNotes: { ...note.fieldNotes, Audio: NO_CLIP_NOTE } };
}

/** Whether a lesson's phrases can come with its recordings: only one made since transcripts were kept. */
export function hasClips(lesson: Pick<AudioLesson, 'script'>): boolean {
  return Array.isArray(lesson.script);
}
