import { describe, expect, it } from 'vitest';
import { choiceText, countChoices, countEnding, countKey, randomCount } from '../../src/tools/counting';

const sequence = (...values: number[]) => () => values.shift() ?? 0;

describe('a random count', () => {
  it('stays within the nouns and from 1 to the most asked for', () => {
    for (let i = 0; i < 500; i++) {
      const q = randomCount(12, 10);
      expect(q.noun).toBeGreaterThanOrEqual(0);
      expect(q.noun).toBeLessThan(12);
      expect(q.n).toBeGreaterThanOrEqual(1);
      expect(q.n).toBeLessThanOrEqual(10);
    }
  });

  it('never asks the same one twice in a row', () => {
    let q = randomCount(3, 10);
    for (let i = 0; i < 200; i++) {
      const next = randomCount(3, 10, q);
      expect(countKey(next)).not.toBe(countKey(q));
      q = next;
    }
  });
});

describe('Pick’s choices', () => {
  const answer = { text: 'trzy koty' };

  it('are the answer and three wrong ones, none shown twice', () => {
    const { choices, correct } = countChoices(answer, ['trzy kot', 'trzy koty', 'trzy kotów', 'trzy kot', 'trzy kota'].map((text) => ({ text })), sequence(0, 0, 0, 0.99));
    expect(choices).toHaveLength(4);
    expect(choices[correct]).toBe(answer);
    expect(new Set(choices.map((p) => p.text)).size).toBe(4);
  });

  it('make do with fewer when there are fewer wrong ones', () => {
    const { choices, correct } = countChoices(answer, [{ text: 'trzy kot' }, { text: 'trzy kotów' }], sequence(0.5, 0));
    expect(choices.map((p) => p.text).sort()).toEqual(['trzy kot', 'trzy koty', 'trzy kotów']);
    expect(choices[correct]).toBe(answer);
  });

  it('tell Japanese choices apart by their reading, as that’s what’s asked', () => {
    const right = { text: '鉛筆が三本', roman: 'えんぴつがさんぼん' };
    const misread = { text: '鉛筆が三本', roman: 'えんぴつがさんほん' };
    const byReading = (p: { text: string; roman?: string }) => choiceText(p, true);
    expect(countChoices(right, [misread], Math.random, byReading).choices).toHaveLength(2);
    expect(countChoices(right, [misread]).choices).toHaveLength(1);
  });
});

describe('a count’s ending', () => {
  it('sorts 11 to 14 apart from 1 and 2 to 4', () => {
    expect([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 100].map(countEnding))
      .toEqual(['1', '2-4', '2-4', 'many', 'teen', 'teen', 'teen', '1', '2-4', 'many', 'many']);
  });
});
