import { describe, expect, it } from 'vitest';
import { makeCards } from '../../src/core/cards';
import { bumpStudied, currentCard } from '../../src/core/session';
import { NOW, omniNote } from '../support/fixtures';

describe('bumpStudied', () => {
  it('counts first answers to new cards and answers to reviews, and takes them back on undo', () => {
    let s = new Map();
    s = bumpStudied(s, 'Thai', 0, 1);
    s = bumpStudied(s, 'Thai', 2, 1);
    s = bumpStudied(s, 'Thai', 1, 1); // learning: not limited, not counted
    expect(s.get('Thai')).toEqual({ introduced: 1, reviewed: 1 });
    s = bumpStudied(s, 'Thai', 2, -1);
    expect(s.get('Thai')).toEqual({ introduced: 1, reviewed: 0 });
    expect(bumpStudied(s, 'Thai', 2, -1).get('Thai')).toEqual({ introduced: 1, reviewed: 0 });
  });
  it('leaves the map it was given alone', () => {
    const s = new Map();
    bumpStudied(s, 'Thai', 0, 1);
    expect(s.size).toBe(0);
  });
});

describe('currentCard', () => {
  it('shows the card an undo brought back, else the queue\'s next', () => {
    const [a] = makeCards({ ...omniNote(), id: 'a' }, NOW);
    const [b] = makeCards({ ...omniNote(), id: 'b' }, NOW);
    const q = { due: [], fresh: [a, b] };
    expect(currentCard(q)?.id).toBe(a.id);
    expect(currentCard(q, b.id)?.id).toBe(b.id);
    expect(currentCard(q, 'gone')?.id).toBe(a.id);
  });
});
