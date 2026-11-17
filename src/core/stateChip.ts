import type { Card } from './types';

/**
 * Which state chip a card shows above its question: New, Learning or Relearning, and for a card on
 * steps, which step of how many (so the chip can draw them). A Review card is the common case and
 * gets none. Read from the card's schedule each time; display only. Pure, so it's tested.
 */

export interface StateChip {
  kind: 'new' | 'learning' | 'relearning';
  /** The step the card is on (1-based) of the deck's steps, when there are two or more to draw. */
  step?: { at: number; of: number };
}

export function stateChip(card: Card, steps: { learn: number[]; relearn: number[] }): StateChip | undefined {
  const s = card.sched;
  if (s.state === 0) return { kind: 'new' };
  if (s.state !== 1 && s.state !== 3) return undefined;
  const list = s.state === 1 ? steps.learn : steps.relearn;
  const kind = s.state === 1 ? 'learning' : 'relearning';
  return list.length >= 2 ? { kind, step: { at: Math.min(Math.max(s.learningSteps, 0), list.length - 1) + 1, of: list.length } } : { kind };
}
