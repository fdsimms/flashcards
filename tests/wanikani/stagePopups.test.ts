import { describe, expect, it } from 'vitest';
import { MAX_POPUPS, nextSide, PUSH_TILT, PUSH_X, PUSH_Y, pushPopup, removePopup, stackSlots, X_LIMIT, type Side, type StackEntry } from '../../src/wanikani/stagePopups';

const entry = (id: number, side: Side, up = true): StackEntry => ({ id, side, out: false, change: { group: 'Guru', up, burned: false } });
const build = (...sides: Side[]) => sides.reduce<StackEntry[]>((stack, side, i) => pushPopup(stack, entry(i + 1, side)), []);

describe('stacked level-up popups', () => {
  it('alternates the entry side, starting from the left', () => {
    const a = nextSide(1);
    const b = nextSide(a);
    expect([a, b, nextSide(b)]).toEqual([-1, 1, -1]);
  });

  it('puts the newest level and in place', () => {
    const slots = stackSlots(build(-1, 1, -1));
    expect(slots[2]).toEqual({ x: 0, y: 0, tilt: 0, scale: 1, opacity: 1 });
  });

  it('pushes an older popup up and away from the side the newer one came from', () => {
    const fromLeft = stackSlots(build(1, -1))[0];
    expect(fromLeft.x).toBe(PUSH_X);
    expect(fromLeft.y).toBe(-PUSH_Y);
    expect(fromLeft.tilt).toBe(PUSH_TILT);
    const fromRight = stackSlots(build(-1, 1))[0];
    expect(fromRight.x).toBe(-PUSH_X);
    expect(fromRight.tilt).toBe(-PUSH_TILT);
  });

  it('zigzags around the middle for alternating sides, and never goes past the limit', () => {
    const slots = stackSlots(build(-1, 1, -1));
    expect(slots[1].x).toBe(PUSH_X);
    expect(slots[0].x).toBe(0);
    const sameSide = stackSlots(build(-1, -1, -1, -1));
    expect(Math.max(...sameSide.map((s) => Math.abs(s.x)))).toBeLessThanOrEqual(X_LIMIT);
  });

  it('pushes only upward for a drop', () => {
    const stack = pushPopup(build(1), entry(2, 0, false));
    const [older] = stackSlots(stack);
    expect(older.x).toBe(0);
    expect(older.tilt).toBe(0);
    expect(older.y).toBe(-PUSH_Y);
  });

  it('dims older popups and fades the oldest out when there are too many', () => {
    const three = stackSlots(build(-1, 1, -1));
    expect(three.map((s) => s.opacity)).toEqual([0.5, 0.75, 1]);
    const four = build(-1, 1, -1, 1);
    expect(four.filter((e) => e.out).map((e) => e.id)).toEqual([1]);
    expect(four.filter((e) => !e.out)).toHaveLength(MAX_POPUPS);
    expect(stackSlots(four)[0].opacity).toBe(0);
    expect(stackSlots(four)[1].opacity).toBe(0.5);
  });

  it('removes one by id and lets the rest settle back', () => {
    const stack = build(-1, 1, -1);
    const without = removePopup(stack, 2);
    expect(without.map((e) => e.id)).toEqual([1, 3]);
    expect(stackSlots(without)[0].x).toBe(PUSH_X);
    expect(removePopup(stack, 99)).toBe(stack);
  });
});
