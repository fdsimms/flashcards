import { describe, expect, it } from 'vitest';
import { makeCards } from '../../src/core/cards';
import { studiedKind } from '../../src/core/queue';
import { bumpStudied, currentCard } from '../../src/core/session';
import { NOW, omniNote } from '../support/fixtures';

describe('bumpStudied', () => {
  it('counts first answers to new cards and answers to reviews, and takes them back on undo', () => {
    let s = new Map();
    s = bumpStudied(s, 'Thai', 'new', 1);
    s = bumpStudied(s, 'Thai', 'review', 1);
    s = bumpStudied(s, 'Thai', null, 1); // a step within the day: not limited, not counted
    expect(s.get('Thai')).toEqual({ introduced: 1, reviewed: 1 });
    s = bumpStudied(s, 'Thai', 'review', -1);
    expect(s.get('Thai')).toEqual({ introduced: 1, reviewed: 0 });
    expect(bumpStudied(s, 'Thai', 'review', -1).get('Thai')).toEqual({ introduced: 1, reviewed: 0 });
  });
  it("says what an answer uses: a new card's first, a review, or a day-long learning step", () => {
    const [card] = makeCards(omniNote(), NOW);
    const at = (d: number) => new Date(2026, 10, d, 9).toISOString();
    expect(studiedKind(card, 4)).toBe('new');
    expect(studiedKind({ ...card, sched: { ...card.sched, state: 2 } }, 4)).toBe('review');
    expect(studiedKind({ ...card, sched: { ...card.sched, state: 1, due: at(11), lastReview: at(10) } }, 4)).toBe('review');
    expect(studiedKind({ ...card, sched: { ...card.sched, state: 1, due: at(11), lastReview: at(11) } }, 4)).toBeNull();
  });
  it('leaves the map it was given alone', () => {
    const s = new Map();
    bumpStudied(s, 'Thai', 'new', 1);
    expect(s.size).toBe(0);
  });
});

describe('currentCard', () => {
  it('shows the card an undo brought back, else the queue\'s next', () => {
    const [a] = makeCards({ ...omniNote(), id: 'a' }, NOW);
    const [b] = makeCards({ ...omniNote(), id: 'b' }, NOW);
    const q = { due: [], fresh: [a, b], order: [a, b] };
    expect(currentCard(q)?.id).toBe(a.id);
    expect(currentCard(q, b.id)?.id).toBe(b.id);
    expect(currentCard(q, 'gone')?.id).toBe(a.id);
  });
});
