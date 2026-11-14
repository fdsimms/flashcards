// Score it (docs/read-and-listen/architecture.md, Speaking): what a take's score says in words. Pure, so it's
// tested; nothing here grades a card.
import type { ScoredWord, TakeScore } from './api';

/** The word most worth another try: the lowest-scoring one not said well, or none when every word was. */
export function weakestWord(score: TakeScore): ScoredWord | undefined {
  const off = score.words.filter((w) => w.band !== 'good');
  return off.reduce<ScoredWord | undefined>((low, w) => (!low || w.accuracy < low.accuracy ? w : low), undefined);
}

/** A line on that word: its score, and what Azure said was wrong with it. */
export function weakestLine(w: ScoredWord): string {
  if (w.error === 'Omission') return `${w.word} was left out.`;
  if (w.error === 'Insertion') return `${w.word} was said, but isn't in the text.`;
  const part = w.weakest ? ` Its weakest part is "${w.weakest.text}" (${w.weakest.accuracy} of 100).` : '';
  return `${w.word}, ${w.accuracy} of 100.${part}`;
}

/** The headline: how it went overall. */
export function scoreHeadline(score: TakeScore): string {
  const weakest = weakestWord(score);
  if (!weakest) return 'Every word as a native speaker says it.';
  const again = score.words.filter((w) => w.band === 'again').length;
  return again ? `${again} ${again === 1 ? 'word' : 'words'} worth another try.` : 'Close. A few words could be clearer.';
}
