import { describe, expect, it } from 'vitest';
import { needsWake, WAKE_AFTER_QUIET_MS } from '../../src/core/outputWake';

describe('needsWake', () => {
  const now = 100_000;

  it('wakes Bluetooth after a quiet stretch, and before the first sound', () => {
    expect(needsWake(true, now - WAKE_AFTER_QUIET_MS, now)).toBe(true);
    expect(needsWake(true, Number.NEGATIVE_INFINITY, now)).toBe(true);
  });

  it('leaves words played one after another alone', () => {
    expect(needsWake(true, now - WAKE_AFTER_QUIET_MS + 1, now)).toBe(false);
    expect(needsWake(true, null, now)).toBe(false);
  });

  it('never wakes the speaker, or a route the build can\'t read', () => {
    expect(needsWake(false, Number.NEGATIVE_INFINITY, now)).toBe(false);
    expect(needsWake(null, Number.NEGATIVE_INFINITY, now)).toBe(false);
  });
});
