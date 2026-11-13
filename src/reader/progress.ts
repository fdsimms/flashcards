// The progress card on the topics screen, in words. It reports what happened; it sets no goal.
import type { Progress } from './api';

const percent = (ratio: number) => `${Math.round(ratio * 100)}%`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function describeProgress(p: Progress): { headline: string; detail: string; next: string } {
  const headline = `${plural(p.finished, 'text')} finished in the last ${p.days} days`;
  const rated = p.ratings.too_easy + p.ratings.about_right + p.ratings.too_hard;
  let detail: string;
  if (p.finished === 0 || p.median_coverage === null) {
    detail = "Finish a text and rate it to see how it's going.";
  } else {
    const parts = [`Median ${percent(p.median_coverage)} known words.`];
    if (rated > 0) parts.push(`${p.ratings.about_right} of ${rated} rated about right.`);
    if (p.check && p.check.asked > 0) {
      parts.push(`Checks after ${plural(p.check.texts, 'text')}: ${percent(p.check.right / p.check.asked)} right.`);
    }
    detail = parts.join(' ');
  }
  const next = `New texts aim for at least ${percent(p.next.floor)} known words and ${plural(
    p.next.stretch,
    'practice word',
  )}.`;
  return { headline, detail, next };
}
