// Text difficulty (docs/read-and-listen/architecture.md, Generation and coverage): how many words
// in a new text are outside the deck. Standard is 95% known words, the least the research finds
// adequate for reading and listening; Easier is 97%, about 3 new words in 100 instead of 5; Harder is
// 93%, about 7, below the research's least, so it says so. A poor score on the check, this text's and
// the last checked text's answers taken together, steps a language one level easier by itself
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
  "Standard texts have about 5 new words in 100. Easier has about 3. Harder has about 7, more than research finds you can comfortably follow, so you'll look up more. Applies to texts written from now on. Low scores on the check after two texts in a row make new texts a level easier, and you can change it back here.";
