import type { Phrase } from './phrase';
import { pickOther } from './random';

/**
 * Reading the script: a word in the language's own letters, to read aloud, and in Thai, a
 * syllable whose tone is worked out from how it's written. Each language's own script.ts holds
 * its words and what's worth explaining about reading them. Pure; nothing is scheduled or saved.
 */

/** A word to read. */
export interface ScriptWord {
  /** As the question shows it (Russian without its stress mark). */
  shown: string;
  /** In English, under it. */
  meaning: string;
  /** The answer: as it's read, with its stress or tone, and a romanization. */
  answer: Phrase;
}

export interface ScriptLanguage {
  words: ScriptWord[];
  /** What's worth knowing to read the word, shown after a miss, where there's something certain to say. */
  rule: (word: number) => string | undefined;
  /** The patterns a miss leans toward (marks.ts): a letter pair, a tone rule. */
  patterns: (word: number) => string[];
}

/** Read it aloud and show the answer, or (Thai) name the syllable's tone. */
export const SCRIPT_MODES = ['read', 'tone'] as const;
export type ScriptMode = (typeof SCRIPT_MODES)[number];

/** A word at random, never `previous` again. */
export function randomWord(count: number, previous?: number, random: () => number = Math.random): number {
  return pickOther(count, previous !== undefined && previous < count ? previous : undefined, random);
}
