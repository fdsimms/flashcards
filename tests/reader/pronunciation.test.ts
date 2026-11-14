import { describe, expect, it } from 'vitest';
import type { ScoredWord, TakeScore } from '../../src/reader/api';
import { scoreHeadline, weakestLine, weakestWord } from '../../src/reader/pronunciation';

const word = (w: string, accuracy: number, band: ScoredWord['band'], over: Partial<ScoredWord> = {}): ScoredWord =>
  ({ word: w, accuracy, band, error: null, syllables: [], weakest: null, ...over });
const score = (words: ScoredWord[]): TakeScore => ({ accuracy: 80, fluency: 90, completeness: 100, heard: '', words });

describe('weakestWord', () => {
  it('is the lowest word not said well', () => {
    expect(weakestWord(score([word('a', 95, 'good'), word('z', 70, 'close'), word('mlekiem', 48, 'again')]))?.word).toBe('mlekiem');
  });
  it('is none when every word was said well', () => {
    expect(weakestWord(score([word('a', 95, 'good')]))).toBeUndefined();
  });
});

describe('the lines', () => {
  it('names the weakest part, or what was left out or added', () => {
    expect(weakestLine(word('mlekiem', 48, 'again', { weakest: { text: 'kiem', accuracy: 30 } })))
      .toBe('mlekiem, 48 of 100. Its weakest part is "kiem" (30 of 100).');
    expect(weakestLine(word('kawę', 0, 'again', { error: 'Omission' }))).toBe('kawę was left out.');
    expect(weakestLine(word('no', 0, 'again', { error: 'Insertion' }))).toBe("no was said, but isn't in the text.");
  });
  it('says how it went overall', () => {
    expect(scoreHeadline(score([word('a', 95, 'good')]))).toBe('Every word as a native speaker says it.');
    expect(scoreHeadline(score([word('a', 70, 'close')]))).toBe('Close. A few words could be clearer.');
    expect(scoreHeadline(score([word('a', 40, 'again'), word('b', 30, 'again')]))).toBe('2 words worth another try.');
  });
});
