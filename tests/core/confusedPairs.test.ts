import { describe, expect, it } from 'vitest';
import { isLinked, newPair, partnerIndex, partnerSummary, withoutPair, withPair } from '../../src/core/confusedPairs';

const at = (h: number) => new Date(2026, 10, 11, h);

describe('newPair', () => {
  it('puts the smaller note id first, so either order is the same pair', () => {
    expect(newPair('b', 'a', at(9))).toEqual(newPair('a', 'b', at(9)));
    expect(newPair('b', 'a', at(9))).toMatchObject({ a: 'a', b: 'b' });
  });

  it('refuses a note linked to itself', () => {
    expect(newPair('a', 'a', at(9))).toBeUndefined();
  });
});

describe('the pairs', () => {
  const ab = newPair('a', 'b', at(9))!;
  const ca = newPair('c', 'a', at(10))!;

  it('links two notes once', () => {
    const once = withPair([], ab);
    expect(withPair(once, newPair('b', 'a', at(11))!)).toEqual(once);
    expect(isLinked(once, 'b', 'a')).toBe(true);
    expect(isLinked(once, 'a', 'c')).toBe(false);
  });

  it('takes a link away in either order, leaving the others', () => {
    expect(withoutPair([ab, ca], 'b', 'a')).toEqual([ca]);
    expect(withoutPair([ab], 'a', 'z')).toEqual([ab]);
  });

  it('lists each note\'s partners, the earliest link first', () => {
    const index = partnerIndex([ca, ab]);
    expect(index.get('a')).toEqual(['b', 'c']);
    expect(index.get('b')).toEqual(['a']);
    expect(index.get('c')).toEqual(['a']);
    expect(index.has('z')).toBe(false);
  });
});

describe('partnerSummary', () => {
  it('names the first partner that still exists and counts the rest', () => {
    expect(partnerSummary(['x', 'b', 'c'], (id) => id !== 'x')).toEqual({ first: 'b', more: 1 });
    expect(partnerSummary(['b'], () => true)).toEqual({ first: 'b', more: 0 });
  });

  it('says nothing when none of them exist any more', () => {
    expect(partnerSummary(['x'], () => false)).toBeUndefined();
    expect(partnerSummary([], () => true)).toBeUndefined();
  });
});
