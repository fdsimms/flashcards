import { describe, expect, it } from 'vitest';
import {
  continueFrom, LATE_MS, LEAD_MS, letGo, NOT_WAITING, parseWait, pauseAt, pausesOf, SETTLE_MS, waitHint, waitTick, type Pause, type WaitState,
} from '../../src/reader/lessonWaits';

const PAUSES: Pause[] = [[2_000, 5_000], [9_000, 13_000]];

describe('pausesOf', () => {
  it('keeps well-formed pauses, in order', () => {
    expect(pausesOf({ pauses: [[9_000, 13_000], [2_000, 5_000]] })).toEqual(PAUSES);
  });

  it('has none for a lesson whose pauses are not known yet, or from an older server', () => {
    expect(pausesOf({ pauses: null })).toEqual([]);
    expect(pausesOf({})).toEqual([]);
  });

  it('drops a pause that is malformed or ends before it starts', () => {
    expect(pausesOf({ pauses: [[5, 1], [1, 2, 3], 'x', [Number.NaN, 4], [1, 4]] as never })).toEqual([[1, 4]]);
  });
});

describe('pauseAt', () => {
  it('finds the pause the player is in', () => {
    expect(pauseAt(PAUSES, 2.0)).toBe(0);
    expect(pauseAt(PAUSES, 10)).toBe(1);
  });

  it('is -1 between pauses', () => {
    expect(pauseAt(PAUSES, 1.9)).toBe(-1);
    expect(pauseAt(PAUSES, 7)).toBe(-1);
    expect(pauseAt([], 3)).toBe(-1);
  });

  it("doesn't stop in a pause's last moment", () => {
    expect(pauseAt(PAUSES, (5_000 - LATE_MS) / 1000 - 0.01)).toBe(0);
    expect(pauseAt(PAUSES, (5_000 - LATE_MS) / 1000)).toBe(-1);
  });
});

describe('continueFrom', () => {
  it('goes on just before the silence ends', () => {
    expect(continueFrom([2_000, 5_000])).toBe((5_000 - LEAD_MS) / 1000);
  });

  it('never goes back before the pause began', () => {
    expect(continueFrom([2_000, 2_100])).toBe(2);
  });
});

describe('waitTick', () => {
  const tick = (state: WaitState, seconds: number, playing: boolean, now = 0) => waitTick(state, PAUSES, { seconds, playing, now });

  it('stops when playing reaches a pause', () => {
    const step = tick(NOT_WAITING, 2.3, true, 100);
    expect(step.act).toBe('hold');
    expect(step.state.held).toEqual({ index: 0, at: 100, paused: false });
  });

  it("does nothing between pauses, or in one while paused (the learner paused there themselves)", () => {
    expect(tick(NOT_WAITING, 1, true).act).toBe('none');
    expect(tick(NOT_WAITING, 3, false).act).toBe('none');
  });

  it("lets a report of playing that comes as the stop lands be", () => {
    const held = tick(NOT_WAITING, 2.3, true, 100).state;
    expect(tick(held, 2.5, true, 100 + SETTLE_MS - 1).act).toBe('none');
  });

  it('goes on past the silence when Play is pressed while held', () => {
    const held = tick(NOT_WAITING, 2.3, true, 100).state;
    const paused = tick(held, 2.4, false, 200).state;
    expect(paused.held?.paused).toBe(true);
    const step = tick(paused, 2.4, true, 300);
    expect(step.act).toBe('continue');
    expect(step.state).toEqual({ held: null, passed: 0 });
  });

  it('treats playing long after the stop as Play pressed, even if the pause was never reported', () => {
    const held = tick(NOT_WAITING, 2.3, true, 100).state;
    expect(tick(held, 2.4, true, 100 + SETTLE_MS).act).toBe('continue');
  });

  it("doesn't stop again in the pause just gone on from, but stops at the next", () => {
    const gone = letGo(tick(NOT_WAITING, 2.3, true).state);
    expect(gone).toEqual({ held: null, passed: 0 });
    const inside = tick(gone, 4.2, true);
    expect(inside.act).toBe('none');
    const between = tick(inside.state, 6, true);
    expect(between.state.passed).toBe(-1);
    expect(tick(between.state, 9.1, true).act).toBe('hold');
  });

  it('stops again in a pause gone on from once the player has left it and come back', () => {
    const gone = letGo(tick(NOT_WAITING, 2.3, true).state);
    const left = tick(gone, 6, true).state;
    expect(tick(left, 2.5, true).act).toBe('hold');
  });
});

describe('letGo', () => {
  it('leaves a state with nothing held as it is', () => {
    expect(letGo(NOT_WAITING)).toBe(NOT_WAITING);
  });
});

describe('parseWait', () => {
  it('is off unless turned on', () => {
    expect(parseWait('on')).toBe(true);
    expect(parseWait('off')).toBe(false);
    expect(parseWait(null)).toBe(false);
    expect(parseWait('yes')).toBe(false);
  });
});

describe('waitHint', () => {
  it('says what the switch does for a lesson with pauses', () => {
    expect(waitHint({ pauses: [[1, 4_000]] })).toBe('Stops at each pause until you tap Continue');
  });

  it("says why an older lesson won't stop yet, and one with no pauses at all", () => {
    expect(waitHint({ pauses: null })).toMatch(/still finding its pauses/);
    expect(waitHint({ pauses: [] })).toMatch(/plays straight through/);
    expect(waitHint({})).toMatch(/plays straight through/);
  });
});
