import { describe, expect, it } from 'vitest';
import type { StoryCharacter } from '../../src/reader/api';
import { badgeLetter, characterOfWord, firstSeen, xraySections } from '../../src/reader/xray';

const hanna: StoryCharacter = { name: 'Hanna', description: "Mia's neighbor.", first_episode: 2, here: true };
const mia: StoryCharacter = { name: 'Mia', description: 'Moved here.', first_episode: 1, here: true };
const brandt: StoryCharacter = { name: 'Herr Brandt', description: 'The baker.', first_episode: 1 };

describe('characterOfWord', () => {
  it('finds the character the server tagged, ignoring capitals', () => {
    expect(characterOfWord({ character: 'hanna' }, [mia, hanna])).toBe(hanna);
  });
  it('is null for an untagged word, no characters, or a name that is not in the list', () => {
    expect(characterOfWord({}, [hanna])).toBeNull();
    expect(characterOfWord({ character: 'Hanna' }, undefined)).toBeNull();
    expect(characterOfWord({ character: 'Anna' }, [hanna])).toBeNull();
  });
});

describe('xraySections', () => {
  it('lists who is in the episode first, then the rest, each by first appearance', () => {
    const { here, earlier } = xraySections([hanna, brandt, mia]);
    expect(here.map((c) => c.name)).toEqual(['Mia', 'Hanna']);
    expect(earlier.map((c) => c.name)).toEqual(['Herr Brandt']);
  });
  it('is empty with no characters', () => {
    expect(xraySections([])).toEqual({ here: [], earlier: [] });
  });
});

it('words when a character was first seen', () => {
  expect(firstSeen(hanna)).toBe('First seen in episode 2');
});

it('takes a badge letter from the name', () => {
  expect(badgeLetter('hanna')).toBe('H');
  expect(badgeLetter('  Аня')).toBe('А');
  expect(badgeLetter('')).toBe('?');
});
