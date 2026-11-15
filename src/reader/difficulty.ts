// Text difficulty (docs/read-and-listen/architecture.md, Generation and coverage): how many words
// in a new text are outside the deck. Standard is 95% known words, the least the research finds
// adequate for reading and listening, and Easier is 97%, about 3 new words in 100 instead of 5. A poor
// score on the check after reading switches a language to Easier by itself (server difficulty.py).
// Pure, so it's tested; ReadLanguage.tsx shows it.
import type { DifficultyLevel } from './api';

// The server sends the target as a fraction: 0.95 or 0.97.
export function levelOf(floor: number): DifficultyLevel {
  return floor >= 0.96 ? 'easier' : 'standard';
}

export const LEVEL_OPTIONS: { value: DifficultyLevel; label: string }[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'easier', label: 'Easier' },
];

export const LEVEL_HELP =
  'Standard texts are 95% words you know, about 5 new words in 100. Easier is 97%, about 3 in 100. It applies from the next text written. A low score on the check after reading switches to Easier by itself, and you can switch back here.';
