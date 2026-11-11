import { describe, expect, it } from 'vitest';
import { makeCards } from '../../src/core/cards';
import { buildQueue, isDue, nextCard, nextLearningDue } from '../../src/core/queue';
import { review } from '../../src/core/scheduler';
import type { Card } from '../../src/core/types';
import { NOW, omniNote } from '../support/fixtures';

const H = 4;

function withSched(card: Card, over: Partial<Card['sched']>): Card {
  return { ...card, sched: { ...card.sched, ...over } };
}

describe('queue', () => {
  it('orders due cards by overdue-ness and puts them before new cards', () => {
    const notes = [1, 2, 3, 4].map((i) => ({ ...omniNote(), id: `n${i}` }));
    const cards = notes.flatMap((n) => makeCards(n, NOW));
    cards[0].sched = review(cards[0].sched, 3, new Date(2026, 10, 1)).sched;
    cards[1].sched = review(cards[1].sched, 3, new Date(2026, 9, 1)).sched;
    const q = buildQueue(cards, { dayStartsAtHour: H, now: new Date(2027, 0, 1, 12) });
    expect(q.due.map((c) => c.id)).toEqual([cards[1].id, cards[0].id]);
    expect(q.fresh).toHaveLength(2);
    expect(nextCard(q)?.id).toBe(cards[1].id);
  });
  it('shows a review card for its whole study day, not from the minute it falls due', () => {
    const [base] = makeCards(omniNote(), NOW);
    const card = withSched(base, { state: 2, due: new Date(2026, 10, 12, 21, 0).toISOString() });
    expect(isDue(card, new Date(2026, 10, 12, 8, 0), H)).toBe(true);
    // Before the reset hour it's still the 11th's study day, so the 12th's review isn't due yet.
    expect(isDue(card, new Date(2026, 10, 12, 2, 0), H)).toBe(false);
    expect(isDue(card, new Date(2026, 10, 11, 22, 0), H)).toBe(false);
  });
  it('holds a learning card to its exact due time', () => {
    const [base] = makeCards(omniNote(), NOW);
    const card = withSched(base, { state: 1, due: new Date(2026, 10, 12, 9, 10).toISOString() });
    expect(isDue(card, new Date(2026, 10, 12, 9, 0), H)).toBe(false);
    expect(isDue(card, new Date(2026, 10, 12, 9, 10), H)).toBe(true);
  });
  it('never counts a new card as due, and leaves out suspended and retired cards', () => {
    const [base] = makeCards(omniNote(), NOW);
    expect(isDue(base, NOW, H)).toBe(false);
    const due = withSched(base, { state: 2, due: NOW.toISOString() });
    expect(buildQueue([{ ...due, suspended: true }], { dayStartsAtHour: H, now: NOW }).due).toHaveLength(0);
    expect(buildQueue([{ ...due, retired: true }], { dayStartsAtHour: H, now: NOW }).due).toHaveLength(0);
    expect(buildQueue([{ ...base, retired: true }], { dayStartsAtHour: H, now: NOW }).fresh).toHaveLength(0);
  });
  it('says when the next learning card comes due', () => {
    const [base] = makeCards(omniNote(), NOW);
    const at = new Date(2026, 10, 11, 13, 0);
    expect(nextLearningDue([base])).toBeUndefined();
    expect(nextLearningDue([withSched(base, { state: 1, due: at.toISOString() })])).toEqual(at);
  });
});
