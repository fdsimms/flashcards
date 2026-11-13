import { describe, expect, it } from 'vitest';
import { RUSSIAN_COUNTING as ru } from '../../../src/tools/russian/counting';

const find = (meaning: string) => ru.nouns.findIndex((n) => n.meaning === meaning);
const said = (meaning: string, n: number) => ru.say(find(meaning), n).everyday.text;

describe('counting things in Russian', () => {
  it('puts the noun in the case the number calls for', () => {
    expect([1, 2, 5, 11, 21, 22, 25].map((n) => said('cat', n)))
      .toEqual(['один кот', 'два кота', 'пять котов', 'одиннадцать котов', 'двадцать один кот', 'двадцать два кота', 'двадцать пять котов']);
  });

  it('makes one and two agree with the noun', () => {
    expect([1, 2, 21].map((n) => said('book', n))).toEqual(['одна книга', 'две книги', 'двадцать одна книга']);
    expect([1, 21].map((n) => said('apple', n))).toEqual(['одно яблоко', 'двадцать одно яблоко']);
    expect(ru.say(find('cat'), 2).everyday.roman).toBe('dva kota');
  });

  it('explains the case after a miss', () => {
    expect(ru.rule(find('cat'), 22)).toContain('genitive singular: двадцать два кота');
    expect(ru.rule(find('cat'), 12)).toContain('genitive plural: двенадцать котов');
  });
});
