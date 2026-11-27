import { describe, expect, it } from 'vitest';
import { hasStrokeFile, KANJIVG_VERSION, parseStrokes, STROKE_GAP_MS, STROKE_MS, strokeFileName, strokeLength, strokesAt, strokeUrl } from '../../src/tools/strokeOrder';

// 力 as KanjiVG r20240807 has it (Ulrich Apel, CC BY-SA 3.0), its header comment and DTD left out.
const CHIKARA = `<svg xmlns="http://www.w3.org/2000/svg" width="109" height="109" viewBox="0 0 109 109" xmlns:kvg="https://kanjivg.tagaini.net/">
<g id="kvg:StrokePaths_0529b" style="fill:none;stroke:#000000;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;">
<g id="kvg:0529b" kvg:element="力" kvg:radical="general">
	<path id="kvg:0529b-s1" kvg:type="㇆" d="M21.5,38.25c2.71,1.16,5.48,1.13,8.27,0.71c14.44-2.14,39.36-6.21,53.23-8.21c4.48-0.65,6.25,1.38,5.5,5.75c-2.81,16.37-9,38.75-20,53.25c-6.14,8.09-9.5,3-12.5-0.75"/>
	<path id="kvg:0529b-s2" kvg:type="㇒" d="M56.88,13.68c0.62,2.57,0.56,4.63,0,7.19c-4.11,18.97-16.53,49.27-43.49,68.79"/>
</g>
</g>
<g id="kvg:StrokeNumbers_0529b" style="font-size:8;fill:#808080">
	<text transform="matrix(1 0 0 1 14.75 38.63)">1</text>
	<text transform="matrix(1 0 0 1 46.75 12.13)">2</text>
</g>
</svg>`;

describe('where a character\'s strokes come from', () => {
  it('has a file for one kana or kanji, and nothing else', () => {
    for (const c of ['あ', 'シ', 'ヅ', '力', '人']) expect(hasStrokeFile(c), c).toBe(true);
    for (const c of ['', 'きょう', 'ー', 'ข', 'Б', 'a', '力力']) expect(hasStrokeFile(c), c).toBe(false);
  });

  it('names the file by the code point in five hex digits, at a pinned release on jsDelivr', () => {
    expect(strokeFileName('力')).toBe('0529b.svg');
    expect(strokeFileName('あ')).toBe('03042.svg');
    expect(strokeUrl('力')).toBe(`https://cdn.jsdelivr.net/gh/KanjiVG/kanjivg@${KANJIVG_VERSION}/kanji/0529b.svg`);
    expect(KANJIVG_VERSION).toMatch(/^r\d{8}$/);
  });
});

describe('a KanjiVG file', () => {
  it('gives the strokes in order, where each starts and where its number goes', () => {
    const order = parseStrokes(CHIKARA)!;
    expect(order.strokes).toHaveLength(2);
    expect(order.strokes[0].startsWith('M21.5,38.25c2.71')).toBe(true);
    expect(order.starts).toEqual([{ x: 21.5, y: 38.25 }, { x: 56.88, y: 13.68 }]);
    expect(order.labels).toEqual([{ x: 14.75, y: 38.63 }, { x: 46.75, y: 12.13 }]);
  });

  it('orders the strokes by their number, not by where they are in the file', () => {
    const swapped = '<path id="kvg:0529b-s2" d="M5,6l1,1"/><path id="kvg:0529b-s1" d="M1,2l1,1"/>';
    const order = parseStrokes(swapped)!;
    expect(order.starts).toEqual([{ x: 1, y: 2 }, { x: 5, y: 6 }]);
    // No numbers in the file: each goes at its stroke's start.
    expect(order.labels).toEqual(order.starts);
  });

  it('is not drawn when it is something else, or a stroke is missing', () => {
    expect(parseStrokes('')).toBeNull();
    expect(parseStrokes('<html>Not found</html>')).toBeNull();
    expect(parseStrokes('<path id="kvg:0529b-s1" d="M1,2l1,1"/><path id="kvg:0529b-s3" d="M1,2l1,1"/>')).toBeNull();
    expect(parseStrokes('<path id="kvg:0529b-s1" d="c1,2,3,4,5,6"/>')).toBeNull();
  });
});

describe('how long a stroke is', () => {
  it('measures straight lines exactly, relative or not', () => {
    expect(strokeLength('M0,0L3,4')).toBe(5);
    expect(strokeLength('M10,10l3,4l-3-4')).toBe(10);
    expect(strokeLength('M0,0h5v5H0V0')).toBe(20);
    expect(strokeLength('M0,0l3,4z')).toBe(10);
    expect(strokeLength('M0,0 3,4')).toBe(5);
  });

  it('measures a curve through its control points, never less than the curve', () => {
    // A straight line written as a curve is its own length.
    expect(strokeLength('M0,0c1,0,2,0,3,0')).toBe(3);
    expect(strokeLength('M0,0C0,10,10,10,10,0')).toBe(30);
    const first = strokeLength(parseStrokes(CHIKARA)!.strokes[0])!;
    // 力's first stroke runs across the box and down: well over its width, well under twice round it.
    expect(first).toBeGreaterThan(109);
    expect(first).toBeLessThan(300);
  });

  it('gives none for a path it cannot read', () => {
    expect(strokeLength('M0,0A5,5,0,0,1,10,10')).toBeNull();
    expect(strokeLength('M0,0l1')).toBeNull();
  });
});

describe('playing the strokes', () => {
  const each = STROKE_MS + STROKE_GAP_MS;
  it('pauses, draws a stroke, then moves to the next', () => {
    expect(strokesAt(0, 2)).toEqual({ done: 0, drawing: 0 });
    expect(strokesAt(STROKE_GAP_MS + STROKE_MS / 2, 2)).toEqual({ done: 0, drawing: 0.5 });
    expect(strokesAt(each, 2)).toEqual({ done: 1, drawing: 0 });
    expect(strokesAt(each + STROKE_GAP_MS + STROKE_MS, 2).done).toBe(2);
  });

  it('ends with every stroke drawn', () => {
    expect(strokesAt(each * 2, 2)).toEqual({ done: 2, drawing: 0 });
    expect(strokesAt(each * 50, 2)).toEqual({ done: 2, drawing: 0 });
    expect(strokesAt(-5, 2)).toEqual({ done: 0, drawing: 0 });
  });
});
