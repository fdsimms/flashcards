import { describe, expect, it } from 'vitest';
import { randomWord } from '../../src/tools/script';

describe('a random word', () => {
  it('never comes up twice in a row', () => {
    let i = randomWord(5);
    for (let k = 0; k < 200; k++) {
      const next = randomWord(5, i);
      expect(next).not.toBe(i);
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThan(5);
      i = next;
    }
  });
});
