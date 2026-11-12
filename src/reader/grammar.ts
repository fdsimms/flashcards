// The grammar row on the topics screen, in words.
import type { GrammarPoint } from './api';

const plural = (n: number) => (n === 1 ? 'point' : 'points');

export function grammarSummary(points: GrammarPoint[]): string {
  if (points.length === 0) return 'None for this language yet';
  const practicing = points.filter((p) => p.state === 'practice').length;
  const unknown = points.filter((p) => p.state === 'avoid').length;
  const parts = [
    practicing > 0 ? `Practicing ${practicing} ${plural(practicing)}` : null,
    unknown > 0 ? `${unknown} not known yet` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : 'Nothing chosen';
}
