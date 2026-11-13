import { describe, expect, it } from 'vitest';
import { takeClock } from '../../src/core/selfRecording';

describe('takeClock', () => {
  it('shows minutes and two-digit seconds, rounding down', () => {
    expect(takeClock(0)).toBe('0:00');
    expect(takeClock(2999)).toBe('0:02');
    expect(takeClock(65_000)).toBe('1:05');
  });

  it('never goes below zero', () => {
    expect(takeClock(-500)).toBe('0:00');
  });
});
