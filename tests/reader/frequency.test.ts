import { expect, test } from 'vitest';
import { wordFrequency } from '../../src/reader/frequency';

test('a word is banded by its place in the list, with the place shown', () => {
  expect(wordFrequency({ status: 'known', rank: 1 })).toMatchObject({ band: 'Very common', bars: 4, place: '#1' });
  expect(wordFrequency({ status: 'known', rank: 1000 })).toMatchObject({ band: 'Very common', bars: 4 });
  expect(wordFrequency({ status: 'known', rank: 1001 })).toMatchObject({ band: 'Common', bars: 3 });
  expect(wordFrequency({ status: 'unknown', rank: 6412 })).toMatchObject({ band: 'Uncommon', bars: 2, place: '#6,412' });
  expect(wordFrequency({ status: 'unknown', rank: 10000 })).toMatchObject({ band: 'Uncommon', bars: 2 });
});

test('a word past the end of the list is rare, and says where the list ends', () => {
  expect(wordFrequency({ status: 'unknown', rank: null })).toMatchObject({ band: 'Rare', bars: 1, place: 'Beyond the top 10,000' });
});

test('a name, punctuation or a server without ranks shows nothing', () => {
  expect(wordFrequency({ status: 'name', rank: 50 })).toBeNull();
  expect(wordFrequency({ status: null, rank: null })).toBeNull();
  expect(wordFrequency({ status: 'unknown' })).toBeNull();
});

test('a screen reader hears the band and the place in words', () => {
  expect(wordFrequency({ status: 'known', rank: 6412 })?.spoken).toBe('Uncommon. Number 6,412 among the most common words');
  expect(wordFrequency({ status: 'unknown', rank: null })?.spoken).toBe('Rare. Beyond the top 10,000 most common words');
});
