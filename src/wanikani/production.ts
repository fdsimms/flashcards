import type { Note } from '../core/types';
import type { Assignment, PronunciationAudio, Subject } from './subjects';
import { otherMeanings, primaryMeaning } from './subjects';

/**
 * Production cards for WaniKani's vocabulary: English to Japanese, which WaniKani never asks. Each
 * word that reaches Guru gets an Omnilanguage note in the chosen Anki deck with only its Reverse
 * card (SuppressFrontCard, GenerateReverse), so it's scheduled by FSRS and syncs like any card.
 *
 * A note is found again by its tag `wanikani::<subject id>` (the Entry can be edited), and a word
 * already given one is remembered (`made`), so a note deleted on purpose isn't made again.
 */

export const NOTE_TYPE = 'Omnilanguage';
export const WANIKANI_TAG = 'wanikani';
const SUBJECT_TAG = /^wanikani::(\d+)$/;

export function subjectTag(subjectId: number): string {
  return `wanikani::${subjectId}`;
}

/** The WaniKani subject a note was made from, from its tag. */
export function subjectOfNote(note: Pick<Note, 'tags'>): number | undefined {
  for (const t of note.tags) {
    const m = SUBJECT_TAG.exec(t);
    if (m) return Number(m[1]);
  }
  return undefined;
}

/**
 * Words at Guru or above that have no production note yet and never had one, the earliest to
 * reach Guru first (Anki shows new cards in the order they were added), at most `limit`.
 */
export function productionNeeded(passed: Assignment[], notes: Iterable<Pick<Note, 'tags'>>, made: ReadonlySet<number>, limit: number): Assignment[] {
  const have = new Set<number>();
  for (const n of notes) {
    const id = subjectOfNote(n);
    if (id !== undefined) have.add(id);
  }
  return passed
    .filter((a) => (a.subjectType === 'vocabulary' || a.subjectType === 'kana_vocabulary') && a.srsStage >= 5 && !a.hidden)
    .filter((a) => !have.has(a.subjectId) && !made.has(a.subjectId))
    .sort((a, b) => (a.passedAt ?? '').localeCompare(b.passedAt ?? '') || a.subjectId - b.subjectId)
    .slice(0, Math.max(0, limit));
}

/** The recording to keep for a word: an MP3 (which every Anki client plays), the first voice listed. */
export function audioFor(s: Subject): PronunciationAudio | undefined {
  return s.audio.find((a) => a.contentType === 'audio/mpeg');
}

export function audioFileName(subjectId: number, audio: PronunciationAudio): string {
  return `wanikani-${subjectId}-${audio.voiceActorId}.mp3`;
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The note's fields: the word, its meanings to ask by, its reading, a sentence, and the recording when there is one. */
export function productionFields(s: Subject, audioFile?: string): Record<string, string> {
  const meanings = [primaryMeaning(s), ...otherMeanings(s)].slice(0, 3);
  const readings = s.readings.filter((r) => r.accepted).map((r) => r.reading);
  const sentence = s.contextSentences[0];
  return {
    Entry: escape(s.characters ?? ''),
    Meaning: escape(meanings.join(', ')),
    ...(readings.length ? { KanaReading: escape(readings.join('、')) } : {}),
    ...(sentence ? { Context: escape(sentence.ja), ContextTranslation: escape(sentence.en) } : {}),
    ...(s.partsOfSpeech.length ? { PartOfSpeech: escape(s.partsOfSpeech.join(', ')) } : {}),
    ...(audioFile ? { Audio: `[sound:${audioFile}]` } : {}),
    Language: 'Japanese',
    SuppressFrontCard: 'y',
    GenerateReverse: 'y',
  };
}

export function productionTags(subjectId: number): string[] {
  return [WANIKANI_TAG, subjectTag(subjectId)];
}

/** The deck to suggest for production cards: the first whose own name is Japanese's. */
export function suggestedDeck(decks: string[]): string | undefined {
  return decks.find((d) => /(日本語|japanese|nihongo)\s*$/i.test(d.split('::').pop() ?? ''));
}
