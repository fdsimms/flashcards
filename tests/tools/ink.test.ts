import { describe, expect, it } from 'vitest';
import { extendStroke, inkBounds, inkViewBox, strokePath, type Stroke } from '../../src/tools/ink';

const PAD = { width: 300, height: 300 };

describe('a stroke', () => {
  it('takes a point only once the finger has moved far enough to show', () => {
    const stroke: Stroke = [{ x: 10, y: 10 }];
    expect(extendStroke(stroke, { x: 10.5, y: 10.5 })).toBe(stroke);
    expect(extendStroke(stroke, { x: 14, y: 10 })).toEqual([{ x: 10, y: 10 }, { x: 14, y: 10 }]);
    expect(extendStroke([], { x: 1, y: 2 })).toEqual([{ x: 1, y: 2 }]);
  });

  it('is drawn from its first point to its last, a tap as a dot', () => {
    expect(strokePath([])).toBe('');
    expect(strokePath([{ x: 5, y: 6 }])).toBe('M5 6l0.1 0');
    expect(strokePath([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toBe('M0 0L10 0');
    // A corner is rounded through the midpoint of the points after it.
    expect(strokePath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])).toBe('M0 0Q10 0 10 5L10 10');
    expect(strokePath([{ x: 1.26, y: 2.04 }, { x: 3, y: 4 }])).toBe('M1.3 2L3 4');
  });
});

describe('where the ink is', () => {
  const strokes: Stroke[] = [[{ x: 100, y: 120 }, { x: 160, y: 120 }], [{ x: 130, y: 100 }, { x: 130, y: 220 }]];

  it('is the box around every stroke, and nothing when nothing is drawn', () => {
    expect(inkBounds(strokes)).toEqual({ x: 100, y: 100, width: 60, height: 120 });
    expect(inkBounds([])).toBeNull();
    expect(inkBounds([[]])).toBeNull();
  });

  it('shows the whole box when nothing is drawn', () => {
    expect(inkViewBox([], PAD)).toEqual({ x: 0, y: 0, width: 300, height: 300 });
  });

  it('frames the writing with room around it, in the shape asked for and about its middle', () => {
    const square = inkViewBox(strokes, PAD, 1);
    expect(square.width).toBeCloseTo(square.height);
    expect(square.height).toBeCloseTo(120 * 1.24);
    expect(square.x + square.width / 2).toBeCloseTo(130);
    expect(square.y + square.height / 2).toBeCloseTo(160);
    const wide = inkViewBox(strokes, { width: 300, height: 150 }, 2);
    expect(wide.width / wide.height).toBeCloseTo(2);
    expect(wide.height).toBeCloseTo(120 * 1.24);
  });

  it('holds all of the writing whatever size it was written', () => {
    for (const s of [strokes, [[{ x: 2, y: 2 }, { x: 298, y: 30 }]], [[{ x: 150, y: 5 }, { x: 150, y: 295 }]]] as Stroke[][]) {
      const b = inkBounds(s)!;
      const box = inkViewBox(s, PAD, 1);
      expect(box.x).toBeLessThanOrEqual(b.x);
      expect(box.y).toBeLessThanOrEqual(b.y);
      expect(box.x + box.width).toBeGreaterThanOrEqual(b.x + b.width);
      expect(box.y + box.height).toBeGreaterThanOrEqual(b.y + b.height);
    }
  });

  it('does not blow a dot up to fill the frame', () => {
    const box = inkViewBox([[{ x: 150, y: 150 }]], PAD, 1);
    expect(box.width).toBeCloseTo(300 * 0.35);
    expect(box.height).toBeCloseTo(300 * 0.35);
  });
});
