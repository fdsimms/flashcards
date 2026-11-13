// Which words of the line playing are being spoken, from the times the server sends with each word
// (`Word.time`, from Azure's word boundaries). Pure, so the rule is tested; the player is read in
// ui/useSpokenWords.ts.
import type { Word } from './api';

// How long the last word stays lit after Azure says it ended, so it doesn't go out before the
// voice has trailed off.
const LAST_WORD_LINGER_MS = 400;

/**
 * The indices of the words being spoken `ms` into their line's audio. A word stays lit through the
 * pause after it until the next one starts. Words that start together (one word to Azure, two
 * here) light up together. None before the first word, after the last has ended, or in a line
 * recorded without timings.
 */
export function spokenWords(words: Word[], ms: number): number[] {
  let start: number | null = null;
  let last = -Infinity;
  for (const w of words) {
    if (!w.time) continue;
    last = Math.max(last, w.time[0]);
    if (w.time[0] <= ms && (start === null || w.time[0] > start)) start = w.time[0];
  }
  if (start === null) return [];
  const lit = words.flatMap((w, i) => (w.time?.[0] === start ? [i] : []));
  if (start === last) {
    const end = Math.max(...lit.map((i) => words[i].time![1]));
    if (ms > end + LAST_WORD_LINGER_MS) return [];
  }
  return lit;
}
