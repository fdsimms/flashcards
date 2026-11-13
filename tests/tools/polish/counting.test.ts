import { describe, expect, it } from 'vitest';
import { POLISH_COUNTING as pl } from '../../../src/tools/polish/counting';

const find = (meaning: string) => pl.nouns.findIndex((n) => n.meaning === meaning);
const said = (meaning: string, n: number) => pl.say(find(meaning), n).everyday.text;

describe('counting things in Polish', () => {
  it('puts the noun in the case the number calls for', () => {
    expect([1, 2, 5, 12, 21, 22, 25].map((n) => said('cat', n)))
      .toEqual(['jeden kot', 'dwa koty', 'pięć kotów', 'dwanaście kotów', 'dwadzieścia jeden kotów', 'dwadzieścia dwa koty', 'dwadzieścia pięć kotów']);
  });

  it('makes one and two agree with the noun', () => {
    expect([1, 2, 22].map((n) => said('book', n))).toEqual(['jedna książka', 'dwie książki', 'dwadzieścia dwie książki']);
    expect([1, 2].map((n) => said('apple', n))).toEqual(['jedno jabłko', 'dwa jabłka']);
  });

  it('offers the other forms as wrong choices, and explains the case after a miss', () => {
    expect(pl.wrong(find('book'), 2).map((p) => p.text)).toContain('dwa książki');
    expect(pl.rule(find('cat'), 25)).toContain('genitive plural: dwadzieścia pięć kotów');
    expect(pl.rule(find('book'), 2)).toContain('dwie');
  });
});
