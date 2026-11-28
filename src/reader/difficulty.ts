// Text difficulty (docs/read-and-listen/architecture.md, Generation and coverage): how many words
// in a new text are outside the deck. Standard is 95% known words, the least the research finds
// adequate for reading and listening; Easier is 97%, about 3 new words in 100 instead of 5; Harder is
// 93%, about 7, below the research's least, so it says so. A poor score on the check, this text's and
// the last checked text's answers taken together, steps a language one level easier by itself, and a high score one harder
// (server difficulty.py). Pure, so it's tested;
// ReadLanguage.tsx shows it.
import type { DifficultyLevel } from './api';

// The server sends the target as a fraction: 0.93, 0.95 or 0.97.
export function levelOf(floor: number): DifficultyLevel {
  if (floor < 0.94) return 'harder';
  return floor >= 0.96 ? 'easier' : 'standard';
}

export const LEVEL_OPTIONS: { value: DifficultyLevel; label: string }[] = [
  { value: 'harder', label: 'Harder' },
  { value: 'standard', label: 'Standard' },
  { value: 'easier', label: 'Easier' },
];

export const LEVEL_HELP =
  "Standard texts have about 5 new words in 100. Easier has about 3. Harder has about 7, more than research finds you can comfortably follow, so you'll look up more. Applies to texts written from now on. Low scores on the check after two texts in a row make new texts a level easier, and high scores make them a level harder. You can change it back here.";

export type NewWordsStep = 'fewer' | 'same' | 'more';

// Fewest new words first: the order the end view's New words row steps along.
const BY_NEW_WORDS: DifficultyLevel[] = ['easier', 'standard', 'harder'];

/** About how many words in 100 of a text are outside the deck at a level (LEVEL_HELP's figures). */
export function newWordsPer100(level: DifficultyLevel): number {
  return level === 'easier' ? 3 : level === 'harder' ? 7 : 5;
}

/** The level the next texts are written at after a step from `current`, held at the ends. */
export function stepLevel(current: DifficultyLevel, step: NewWordsStep): DifficultyLevel {
  const at = BY_NEW_WORDS.indexOf(current);
  const to = step === 'fewer' ? at - 1 : step === 'more' ? at + 1 : at;
  return BY_NEW_WORDS[Math.min(BY_NEW_WORDS.length - 1, Math.max(0, to))];
}

/** What a step to `to` from `from` means for the texts written next; null when nothing changes. */
export function newWordsStepNote(from: DifficultyLevel, to: DifficultyLevel, step: NewWordsStep): string | null {
  if (step === 'same') return null;
  if (to === from) return `That's as ${step === 'more' ? 'many' : 'few'} as it goes: about ${newWordsPer100(to)} new words in 100.`;
  const base = `About ${newWordsPer100(to)} new words in 100, ${step === 'more' ? 'up' : 'down'} from ${newWordsPer100(from)}.`;
  return to === 'harder' ? `${base} That's more than research finds you can comfortably follow, so you'll look up more.` : base;
}
