import { describe, expect, it, vi } from 'vitest';
import { createSounding } from '../../src/core/sounding';

describe('sounding', () => {
  it('shows pause on the pressed button while its sound plays', () => {
    const s = createSounding();
    const a = {}; const b = {};
    s.press(a);
    expect(s.playing(a)).toBe(false);
    const t = s.begin(() => {});
    expect(s.playing(a)).toBe(true);
    expect(s.playing(b)).toBe(false);
    s.end(t);
    expect(s.playing(a)).toBe(false);
  });

  it('moves to the button pressed next', () => {
    const s = createSounding();
    const a = {}; const b = {};
    s.press(a);
    s.begin(() => {});
    s.press(b);
    expect(s.playing(a)).toBe(false);
    expect(s.playing(b)).toBe(true);
  });

  it('ignores a stopped sound\'s late end once the next has begun', () => {
    const s = createSounding();
    const a = {};
    const stopFirst = vi.fn();
    s.press(a);
    const first = s.begin(stopFirst);
    const second = s.begin(() => {});
    expect(stopFirst).not.toHaveBeenCalled();
    s.end(first);
    expect(s.playing(a)).toBe(true);
    s.end(second);
    expect(s.playing(a)).toBe(false);
  });

  it('stop() calls the sound\'s stop and clears it', () => {
    const s = createSounding();
    const a = {};
    const stop = vi.fn();
    s.press(a);
    s.begin(stop);
    s.stop();
    expect(stop).toHaveBeenCalledOnce();
    expect(s.playing(a)).toBe(false);
    s.stop();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('tells subscribers, and stops telling after unsubscribe', () => {
    const s = createSounding();
    const l = vi.fn();
    const off = s.subscribe(l);
    s.press({});
    const t = s.begin(() => {});
    s.end(t);
    expect(l).toHaveBeenCalledTimes(3);
    off();
    s.press({});
    expect(l).toHaveBeenCalledTimes(3);
  });
});
