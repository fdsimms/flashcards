// Trying a word before its meaning is shown (docs/read-and-listen/architecture.md, Client, Guess
// first). A tapped word's popover can hold its meaning back for a word in the deck, which the
// learner tries to recall, and an optional multiple-choice question stands in for the "Show
// meaning" row. A word outside the deck shows its meaning at once: being made to guess it first
// was dropped as more annoying than useful.
//
// Nothing here grades a card or reaches the scheduler. A lookup is logged when the meaning is
// shown, so a word recalled is never counted as one that was looked up (server recognition.py reads
// that log); a right quiz answer logs nothing, a wrong one or "I don't know" logs the lookup.
// Pure, so it's tested; Reader.tsx's GlossPopover shows it.
import type { ReaderText, Word } from './api';
import { CHOICES, shuffled, withAnswer, type Random } from './check';

export type GuessKind = 'recall';

/**
 * How a word is tried before its meaning: recall, for a word counted as known. Null when there is
 * nothing to try or nothing to show: a word outside the deck (or only inside a longer phrase), a
 * name, punctuation, or a word with no meaning to reveal.
 */
export function guessKind(word: Pick<Word, 'status' | 'gloss' | 'parts'>): GuessKind | null {
  if (!word.gloss?.trim() && !word.parts) return null;
  return word.status === 'known' ? 'recall' : null;
}

export const GUESS_HINT: Record<GuessKind, string> = {
  recall: 'Try to remember it first.',
};

export type Quiz = { choices: string[]; answer: number };

const fold = (s: string) => s.trim().toLocaleLowerCase();

/**
 * Four meanings to pick from for a known word: its own and three other glosses from the same text
 * (the way the check after reading builds its word questions), in a random order. Null when the
 * word has no gloss of its own or the text doesn't have three other distinct ones, and then the
 * popover falls back to the "Show meaning" row.
 */
export function quizFor(word: Pick<Word, 'text' | 'gloss'>, text: Pick<ReaderText, 'lines'>, random: Random = Math.random): Quiz | null {
  const right = word.gloss?.trim();
  if (!right) return null;
  const others = new Map<string, string>();
  for (const line of text.lines) {
    for (const w of line.words) {
      const gloss = w.gloss?.trim();
      if (w.status === null || w.status === 'name' || !gloss || fold(gloss) === fold(right)) continue;
      if (!others.has(fold(gloss))) others.set(fold(gloss), gloss);
    }
  }
  if (others.size < CHOICES - 1) return null;
  const { choices, answer } = withAnswer(right, shuffled([...others.values()], random).slice(0, CHOICES - 1), random);
  return { choices, answer };
}

/** What a tap on a word does: whether its meaning waits behind a try, and whether it's a quiz. */
export type TapMode = { kind: GuessKind; quiz: Quiz | null } | null;

export function tapMode(word: Word, text: Pick<ReaderText, 'lines'> | null, guessFirst: boolean, quizKnown: boolean, random: Random = Math.random): TapMode {
  if (!guessFirst) return null;
  const kind = guessKind(word);
  if (!kind) return null;
  return { kind, quiz: kind === 'recall' && quizKnown && text ? quizFor(word, text, random) : null };
}
