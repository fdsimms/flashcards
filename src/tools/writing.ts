import type { ScriptLanguage } from './script';

/**
 * Writing by hand: a letter, a word or a kanji to write with a finger from its name, sound or
 * meaning, then compare with the real one and mark Missed it or Got it. Each language's own
 * writing.ts holds its letters; its words are the ones Reading the script reads (script.ts), and
 * Japanese's kanji come from WaniKani (src/wanikani/writingKanji.ts). Nothing checks the writing:
 * the learner compares it. Pure; nothing is scheduled or saved.
 */

export interface WritingItem {
  /** What's written: a letter (Russian and Greek: its capital and small forms), a vowel on its consonant, a word, a kanji. */
  text: string;
  /** What the question shows in its place: the letter's name or sound, the word romanized, the kanji's meaning. */
  prompt: string;
  /** A second line under it: a meaning, a sound, a reading. */
  detail?: string;
  /** What the play button reads aloud, in the language. */
  say: string;
  /** What a miss leans the next question toward (marks.ts). */
  patterns: string[];
}

export interface WritingLanguage {
  letters: WritingItem[];
  words: WritingItem[];
}

/** Trace it shows the answer faintly in the box to write over; From memory shows an empty box. */
export const WRITING_MODES = ['trace', 'memory'] as const;
export type WritingMode = (typeof WRITING_MODES)[number];

/** Printed letters, or the joined handwriting a language is written in by hand, where the app has a face for it. */
export const WRITING_STYLES = ['printed', 'cursive'] as const;
export type WritingStyle = (typeof WRITING_STYLES)[number];

/** The languages whose handwriting differs enough from print to practice apart: Russian's т, г and д are other shapes written by hand. */
export const CURSIVE_LANGUAGES: readonly string[] = ['ru'];

/** The style a question is written in: the saved one where the language has cursive, else printed. Kanji and kana have none. */
export function writingStyle(saved: WritingStyle, language: string): WritingStyle {
  return CURSIVE_LANGUAGES.includes(language) ? saved : 'printed';
}

export const WRITING_KINDS = ['letters', 'words', 'kanji'] as const;
export type WritingKind = (typeof WRITING_KINDS)[number];

/** Reading the script's words, to write: asked by how the word sounds and what it means. */
export function wordItems(script: ScriptLanguage): WritingItem[] {
  return script.words.map((w) => ({
    text: w.shown,
    prompt: w.answer.roman ?? w.meaning,
    ...(w.answer.roman ? { detail: w.meaning } : {}),
    say: w.shown,
    patterns: [`word:${w.shown}`],
  }));
}

/** What a language has to write, in the menu's order: kanji only once WaniKani has given some. */
export function writingKinds(language: WritingLanguage, kanji: WritingItem[]): WritingKind[] {
  return WRITING_KINDS.filter((k) => (k === 'kanji' ? kanji : language[k]).length > 0);
}

/** The kind practiced: the saved one where the language has it, else its first. */
export function writingKind(saved: WritingKind, kinds: WritingKind[]): WritingKind | undefined {
  return kinds.includes(saved) ? saved : kinds[0];
}

/** What the question asks for, under the box. */
export function writingHint(kind: WritingKind, mode: WritingMode, shown: boolean): string {
  const thing = kind === 'letters' ? 'letter' : kind === 'words' ? 'word' : 'kanji';
  if (shown) return `Compare with the ${thing}`;
  return `${mode === 'trace' ? 'Trace' : 'Write'} the ${thing}`;
}
