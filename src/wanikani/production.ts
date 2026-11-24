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

/**
 * Words a Title Cased WaniKani gloss keeps capitalized. The same list as `_PROPER` in
 * server/mcp/franki_mcp/omnilanguage.py, whose `meaning-title-case` rule lints notes made before this
 * existed: keep the two in step.
 */
const PROPER = new Set((
  'i monday tuesday wednesday thursday friday saturday sunday january february march april may june july august ' +
  'september october november december japan japanese america american france french england english britain ' +
  'british brit frenchman china chinese korea korean germany german tokyo kyoto osaka fuji mt mount tv ok'
).split(' '));

/** WaniKani writes every word of a meaning with a capital ("To Be Born"); the house style is lowercase glosses, keeping proper nouns. */
export function lowerGloss(text: string): string {
  return text.replace(/[A-Za-z][A-Za-z']*/g, (w) => (PROPER.has(w.toLowerCase()) || (w === w.toUpperCase() && w.length > 1) ? w : w.toLowerCase()));
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * WaniKani's parts of speech as the house list names them (PARTS_OF_SPEECH in
 * server/mcp/franki_mcp/omnilanguage.py, which lint_notes checks against: keep the two in step).
 * A verb's or adjective's kind ("ichidan verb", "な adjective") comes down to verb or adjective.
 */
function housePart(wk: string): string | undefined {
  const p = wk.trim().toLowerCase();
  if (/\bverb$/.test(p)) return 'verb';
  if (/adjective$/.test(p)) return 'adjective';
  if (p === 'counter') return 'classifier';
  if (p === 'expression') return 'phrase';
  return ['noun', 'proper noun', 'numeral', 'adverb', 'pronoun', 'conjunction', 'interjection', 'prefix', 'suffix'].includes(p) ? p : undefined;
}

/** The note's PartOfSpeech, from the first of WaniKani's parts that the house list has, and a verb's VerbClass. */
export function partOfSpeech(partsOfSpeech: string[]): { PartOfSpeech?: string; VerbClass?: string } {
  const part = partsOfSpeech.map(housePart).find((p) => p !== undefined);
  if (!part) return {};
  const kinds = partsOfSpeech.map((p) => p.trim().toLowerCase());
  const verbClass = part !== 'verb' ? undefined
    : kinds.includes('godan verb') ? 'godan' : kinds.includes('ichidan verb') ? 'ichidan' : kinds.includes('する verb') ? 'suru' : undefined;
  return { PartOfSpeech: part, ...(verbClass ? { VerbClass: verbClass } : {}) };
}

/** A sentence with the word in bold where it's written as the word is (a conjugated verb isn't), escaped. */
function withWordBold(sentence: string, characters: string): string {
  const word = characters.replace(/[〜～~]/g, '');
  const at = word ? sentence.indexOf(word) : -1;
  if (at < 0) return escape(sentence);
  return escape(sentence.slice(0, at)) + '<b>' + escape(word) + '</b>' + escape(sentence.slice(at + word.length));
}

/** The glosses the note's Meaning lists: WaniKani's primary meaning and the next two it accepts, lowercased. */
function glossesOf(s: Subject): string[] {
  return [primaryMeaning(s), ...otherMeanings(s)].slice(0, 3).map(lowerGloss);
}

/**
 * Which of a word's glosses are different senses, as Read & Listen's server sorted them
 * (server/reader/src/franki_reader/wanikani_senses.py): each sense's glosses and its example
 * sentence, as indexes into the word's glosses and `contextSentences`, and a label for each.
 */
export interface Senses {
  glosses: number[][];
  sentences: number[];
  labels: string[];
}

/** What the server is asked about a word: only one with two or more glosses has senses to sort. */
export function sensesAsked(s: Subject): { id: number; characters: string; glosses: string[]; sentences: { ja: string; en: string }[] } | undefined {
  const glosses = glossesOf(s);
  if (glosses.length < 2 || !s.characters) return undefined;
  return { id: s.id, characters: s.characters, glosses, sentences: s.contextSentences.slice(0, 3) };
}

/** Senses that still fit the word: two or three, every gloss in exactly one, each with a sentence of its own and a label. */
function fits(s: Subject, glosses: string[], senses: Senses): boolean {
  const n = senses.glosses.length;
  if (n < 2 || n > 3 || senses.sentences.length !== n || senses.labels.length !== n) return false;
  const used = senses.glosses.flat().sort((a, b) => a - b);
  if (used.length !== glosses.length || used.some((g, i) => g !== i)) return false;
  if (senses.glosses.some((g) => !g.length)) return false;
  if (new Set(senses.sentences).size !== n || senses.sentences.some((i) => !s.contextSentences[i])) return false;
  return senses.labels.every((l) => !!l.trim());
}

/**
 * The note's fields: the word, its meanings to ask by (lowercase, joined with "; "), its reading, a
 * sentence with the word in bold, its part of speech and register, and the recording when there is one. Given `senses` that fit, the meanings are numbered,
 * one sense to a line, each with its own sentence and label, as the house style writes a word with
 * different senses (月: "1. moon<br>2. month"); senses that don't fit are ignored.
 */
export function productionFields(s: Subject, audioFile?: string, senses?: Senses): Record<string, string> {
  const glosses = glossesOf(s);
  const readings = s.readings.filter((r) => r.accepted).map((r) => r.reading);
  const sentence = s.contextSentences[0];
  const split = senses && fits(s, glosses, senses) ? senses : undefined;
  const examples: Record<string, string> = split
    ? {
        Context: split.sentences.map((i) => withWordBold(s.contextSentences[i].ja, s.characters ?? '')).join('<br>'),
        ContextTranslation: split.sentences.map((i) => escape(s.contextSentences[i].en)).join('<br>'),
        ContextLabels: split.labels.map((l) => escape(l.trim())).join('<br>'),
      }
    : sentence ? { Context: withWordBold(sentence.ja, s.characters ?? ''), ContextTranslation: escape(sentence.en) } : {};
  return {
    Entry: escape(s.characters ?? ''),
    Meaning: split
      ? split.glosses.map((g, i) => `${i + 1}. ${g.map((j) => escape(glosses[j])).join('; ')}`).join('<br>')
      : escape(glosses.join('; ')),
    ...(readings.length ? { KanaReading: escape(readings.join('、')) } : {}),
    ...examples,
    ...partOfSpeech(s.partsOfSpeech),
    Register: 'neutral',
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
