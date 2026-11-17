import { describe, expect, it } from 'vitest';
import { toneOf, toneSpans } from '../../src/core/toneColors';

describe('Thai tones from a romanization', () => {
  it('reads each tone from its mark, and no mark as mid', () => {
    expect(toneOf('sà')).toBe('low');
    expect(toneOf('mâj')).toBe('falling');
    expect(toneOf('kʰáw')).toBe('high');
    expect(toneOf('sǎm')).toBe('rising');
    expect(toneOf('dii')).toBeUndefined();
  });

  it('reads a mark written as a separate combining character the same', () => {
    expect(toneOf('sà')).toBe('low');
  });

  it('splits at hyphens and spaces, which stay with the syllable before them', () => {
    expect(toneSpans('phûu-yǐng khon')).toEqual([
      { text: 'phûu-', tone: 'falling' },
      { text: 'yǐng ', tone: 'rising' },
      { text: 'khon', tone: undefined },
    ]);
  });

  it('joins back into exactly the text it was given', () => {
    const text = 'chǎn chûue Ni-daa';
    expect(toneSpans(text).map((s) => s.text).join('')).toBe(text);
    expect(toneSpans('')).toEqual([]);
  });
});
