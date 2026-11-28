import { describe, expect, it } from 'vitest';
import { SHADOW_GRACE_MS, nextShadowLine, shadowStart, shadowTick } from '../../src/reader/shadow';

const TIMES: [number, number][] = [[1000, 3500], [4000, 6000], [6500, 9000]];

describe('shadowing a line', () => {
  it('stops once the line has played to its end, a little after so its last word is heard', () => {
    let at = shadowTick(TIMES, 1, false, 4100);
    expect(at).toEqual({ begun: true, done: false });
    at = shadowTick(TIMES, 1, at.begun, 6000);
    expect(at.done).toBe(false);
    expect(shadowTick(TIMES, 1, true, 6000 + SHADOW_GRACE_MS).done).toBe(true);
  });

  it("doesn't take the player's old position for the line ending, before the seek takes", () => {
    // Played again from just past its end: the first time heard is still there.
    expect(shadowTick(TIMES, 1, false, 6400)).toEqual({ begun: false, done: false });
    // And from a later line.
    expect(shadowTick(TIMES, 0, false, 8000)).toEqual({ begun: false, done: false });
    expect(shadowTick(TIMES, 0, false, 900)).toEqual({ begun: true, done: false });
    expect(shadowTick(TIMES, 9, true, 900)).toEqual({ begun: true, done: false });
  });

  it('starts on the line being said, else the first, and goes on to the next until the last', () => {
    expect(shadowStart(-1, 3)).toBe(0);
    expect(shadowStart(2, 3)).toBe(2);
    expect(shadowStart(7, 3)).toBe(2);
    expect(shadowStart(0, 0)).toBe(-1);
    expect(nextShadowLine(0, 3)).toBe(1);
    expect(nextShadowLine(2, 3)).toBeNull();
  });
});
