import { describe, expect, it } from 'vitest';
import { aspectPartners, groupPartners } from '../../src/core/aspectPairs';
import { makeCards } from '../../src/core/cards';
import { treeQueue, type TreeQueueInput } from '../../src/core/deckTree';
import type { Card, Note } from '../../src/core/types';
import { NOW, omniNote } from '../support/fixtures';

const verb = (id: string, entry: string, partner: string, language = 'Polish'): Note => ({
  ...omniNote({ Entry: entry, Meaning: 'm', AspectPartner: partner, Language: language }),
  id,
});
const cardsOf = (n: Note) => makeCards(n, NOW);
const toReview = (c: Card): Card => ({ ...c, sched: { ...c.sched, state: 2, due: new Date(2026, 10, 10, 12).toISOString() } });

describe('aspectPartners', () => {
  it('links two verbs that name each other, both ways', () => {
    const p = aspectPartners([verb('a', 'czytać', 'przeczytać'), verb('b', 'przeczytać', 'czytać')]);
    expect(p.get('a')).toBe('b');
    expect(p.get('b')).toBe('a');
  });
  it('links a verb whose partner does not name it back', () => {
    const p = aspectPartners([verb('a', 'czytać', 'przeczytać'), verb('b', 'przeczytać', '')]);
    expect(p.get('a')).toBe('b');
    expect(p.get('b')).toBe('a');
  });
  it('pairs nothing for a missing partner, "-", itself, another language or a non-aspect language', () => {
    expect(aspectPartners([verb('a', 'czytać', 'przeczytać')]).size).toBe(0);
    expect(aspectPartners([verb('a', 'czytać', '-'), verb('b', 'przeczytać', '')]).size).toBe(0);
    expect(aspectPartners([verb('a', 'czytać', 'czytać')]).size).toBe(0);
    expect(aspectPartners([verb('a', 'читать', 'прочитать', 'Russian'), verb('b', 'прочитать', 'читать', 'Polish')]).size).toBe(0);
    expect(aspectPartners([verb('a', 'lesen', 'durchlesen', 'German'), verb('b', 'durchlesen', 'lesen', 'German')]).size).toBe(0);
  });
  it('compares without case or markup', () => {
    const p = aspectPartners([verb('a', 'Czytać', '<b>przeczytać</b>'), verb('b', 'przeczytać', 'czytać')]);
    expect(p.get('a')).toBe('b');
  });
});

describe('groupPartners', () => {
  const a = cardsOf(verb('a', 'czytać', 'przeczytać'))[0];
  const b = cardsOf(verb('b', 'przeczytać', 'czytać'))[0];
  const x = cardsOf(verb('x', 'pisać', '-'))[0];
  const y = cardsOf(verb('y', 'kot', '-'))[0];
  const p = new Map([['a', 'b'], ['b', 'a']]);
  it('puts a partner right after its card and leaves the rest in order', () => {
    expect(groupPartners([a, x, y, b], p).map((c) => c.noteId)).toEqual(['a', 'b', 'x', 'y']);
    expect(groupPartners([b, x, a], p).map((c) => c.noteId)).toEqual(['b', 'a', 'x']);
  });
  it('pairs only the cards it is told to', () => {
    expect(groupPartners([a, x, b], p, new Set([a.id])).map((c) => c.noteId)).toEqual(['a', 'x', 'b']);
    expect(groupPartners([a, x, b], p, new Set([a.id, b.id])).map((c) => c.noteId)).toEqual(['a', 'b', 'x']);
  });
});

describe('treeQueue with aspect pairs', () => {
  const run = (cards: Card[], newPerDay: number, pairs: Note[]): Queue2 => {
    const input: TreeQueueInput = {
      skillCards: new Set(),
      cardsByDeck: new Map([['Polski', cards]]),
      limitsFor: () => ({ newPerDay, reviewsPerDay: 200 }),
      studiedByDeck: new Map(),
      dayStartsAtHour: 4,
      now: NOW,
      partnerOf: aspectPartners(pairs),
    };
    return treeQueue('Polski', input);
  };
  type Queue2 = ReturnType<typeof treeQueue>;
  const read = verb('a', 'czytać', 'przeczytać');
  const readP = verb('b', 'przeczytać', 'czytać');
  const filler = Array.from({ length: 4 }, (_, i) => cardsOf(verb(`f${i}`, `słowo${i}`, '-'))[0]);

  it('offers a new verb with its new partner side by side', () => {
    const q = run([...filler.slice(0, 2), cardsOf(read)[0], ...filler.slice(2), cardsOf(readP)[0]], 20, [read, readP]);
    const ids = q.fresh.map((c) => c.noteId);
    expect(ids.indexOf('b')).toBe(ids.indexOf('a') + 1);
    expect(q.order.map((c) => c.noteId)).toContain('b');
  });
  it('brings the partner in over the limit, in the place of a card that is not half of a pair', () => {
    const q = run([cardsOf(read)[0], ...filler, cardsOf(readP)[0]], 2, [read, readP]);
    expect(q.fresh.map((c) => c.noteId)).toEqual(['a', 'b']);
  });
  it('never offers more than the daily limit for a pair', () => {
    const q = run([cardsOf(read)[0], ...filler, cardsOf(readP)[0]], 3, [read, readP]);
    expect(q.fresh).toHaveLength(3);
    expect(q.fresh.map((c) => c.noteId)).toContain('b');
  });
  it('leaves a pair split when only one place is left, rather than going past the limit', () => {
    const q = run([cardsOf(read)[0], ...filler, cardsOf(readP)[0]], 1, [read, readP]);
    expect(q.fresh.map((c) => c.noteId)).toEqual(['a']);
  });
  it('adds nothing for a verb whose partner has no card to offer', () => {
    const q = run([cardsOf(read)[0], ...filler], 1, [read, readP]);
    expect(q.fresh).toHaveLength(1);
  });
  it('leaves the partner out when no room is left', () => {
    const q = run([cardsOf(read)[0], cardsOf(readP)[0]], 0, [read, readP]);
    expect(q.fresh).toHaveLength(0);
  });
  it('does not pull in a partner that was already studied', () => {
    const q = run([cardsOf(read)[0], toReview(cardsOf(readP)[0]), ...filler], 5, [read, readP]);
    expect(q.fresh.map((c) => c.noteId)).not.toContain('b');
    expect(q.due.map((c) => c.noteId)).toEqual(['b']);
  });
  it('keeps a pair side by side in the mix among reviews', () => {
    const reviews = Array.from({ length: 12 }, (_, i) => toReview(cardsOf(verb(`r${i}`, `r${i}`, '-'))[0]));
    const q = run([...reviews, cardsOf(read)[0], ...filler, cardsOf(readP)[0]], 20, [read, readP]);
    const ids = q.order.map((c) => c.noteId);
    expect(ids.indexOf('b')).toBe(ids.indexOf('a') + 1);
  });
  it('changes nothing for a deck with no pairs', () => {
    const cards = [cardsOf(read)[0], ...filler];
    expect(run(cards, 20, []).order.map((c) => c.id)).toEqual(treeQueue('Polski', { skillCards: new Set(), cardsByDeck: new Map([['Polski', cards]]), limitsFor: () => ({ newPerDay: 20, reviewsPerDay: 200 }), studiedByDeck: new Map(), dayStartsAtHour: 4, now: NOW }).order.map((c) => c.id));
  });
});
