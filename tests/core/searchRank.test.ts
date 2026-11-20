import { describe, expect, it } from 'vitest';
import { searchPlace, searchQuery, searchRank } from '../../src/core/searchRank';

const rank = (places: string[], q: string) => searchRank(places.map(searchPlace), searchQuery(q));

describe('searchRank', () => {
  it('ranks a listed term before a whole word, the start of a word, then anywhere', () => {
    expect(rank(['performance; show'], 'performance')).toBe(0);
    expect(rank(['1. to perform; to act<br>2. to show'.replace('<br>', '\n')], 'perform')).toBe(0);
    expect(rank(['a musical performance'], 'performance')).toBe(1);
    expect(rank(['performances'], 'performance')).toBe(2);
    expect(rank(['การแสดง'], 'แสดง')).toBe(3);
  });

  it('ranks an earlier place before a better match in a later one', () => {
    expect(rank(['xperformancex', 'performance'], 'performance')).toBe(3);
    expect(rank(['', 'performance'], 'performance')).toBe(4);
    expect(rank(['', '', 'performance'], 'performance')).toBe(8);
  });

  it('finds a word typed without its accents, just behind one typed with them', () => {
    expect(rank(['żółw'], 'zolw')).toBe(0.25);
    expect(rank(['żółw'], 'żółw')).toBe(0);
    expect(rank(['Straße'], 'strasse')).toBe(0.25);
    expect(rank(['ёлка'], 'елка')).toBe(0.25);
    // Thai vowels and tones and kana's voicing marks are part of the word, not accents.
    expect(rank(['ใกล้'], 'ใกล')).toBe(2);
    expect(rank(['ดี'], 'ด')).toBe(2);
    expect(rank(['ตี'], 'ติ')).toBeUndefined();
    expect(rank(['がっこう'], 'かっこう')).toBeUndefined();
  });

  it('needs every word, and ranks words found apart behind them found together', () => {
    expect(rank(['the piano and musical performance hushed the room'], 'musical performance')).toBe(1);
    expect(rank(['performance; show'], 'performance show')).toBe(0.5);
    expect(rank(['show', 'performance'], 'performance show')).toBe(4.5);
    expect(rank(['performance'], 'performance show')).toBeUndefined();
  });

  it('finds nothing for an empty search', () => {
    expect(rank(['anything'], '   ')).toBeUndefined();
  });
});
