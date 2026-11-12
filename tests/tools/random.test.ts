import { describe, expect, it } from 'vitest';
import { pickOther } from '../../src/tools/random';

const sequence = (...values: number[]) => () => values.shift() ?? 0;

describe('a choice at random', () => {
  it('covers every choice', () => {
    expect(pickOther(10, undefined, () => 0)).toBe(0);
    expect(pickOther(10, undefined, () => 0.99999)).toBe(9);
  });

  it('never repeats the previous one', () => {
    expect(pickOther(10, 0, sequence(0, 0))).toBe(1);
    expect(pickOther(10, 9, sequence(0.99999, 0.99999))).toBe(8);
    for (let i = 0; i < 200; i++) expect(pickOther(3, 1)).not.toBe(1);
  });

  it('gives the only choice there is', () => {
    expect(pickOther(1, 0, () => 0)).toBe(0);
  });
});
