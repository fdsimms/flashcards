import { describe, expect, it } from 'vitest';
import { drawingPaths, isEmoji, MAX_DRAWING_LENGTH, MAX_PATHS, parsePicture } from '../../src/core/noteIcon';

describe('isEmoji', () => {
  it('takes one emoji, built of one code point or several', () => {
    for (const e of ['🐘', '☂️', '👨‍⚕️', '🇹🇭', '🔑']) expect(isEmoji(e), e).toBe(true);
  });
  it('refuses words, an emoji with words, a run of them, and a bare joiner', () => {
    for (const e of ['', 'umbrella', '☂️ umbrella', '🐘'.repeat(9), '\ufe0f', 'M3 12']) expect(isEmoji(e), e).toBe(false);
  });
});

describe('drawingPaths', () => {
  it('splits path data on bars', () => {
    expect(drawingPaths('M3 12a9 9 0 0 1 18 0z | M12 12v7a2 2 0 0 1-4 0')).toEqual(['M3 12a9 9 0 0 1 18 0z', 'M12 12v7a2 2 0 0 1-4 0']);
    expect(drawingPaths('m1.5,2e1 l-3 4')).toEqual(['m1.5,2e1 l-3 4']);
  });
  it('refuses anything that is not path data: markup, words, an empty path, too many or too long', () => {
    for (const bad of ['', '<svg><path d="M0 0"/></svg>', 'M0 0" onload="x', 'L3 4', 'M0 0||M1 1', 'umbrella', 'M0 0;alert(1)']) expect(drawingPaths(bad), bad).toBeNull();
    expect(drawingPaths(Array.from({ length: MAX_PATHS + 1 }, () => 'M0 0').join('|'))).toBeNull();
    expect(drawingPaths(`M0 0${' 1'.repeat(MAX_DRAWING_LENGTH)}`)).toBeNull();
  });
});

describe('parsePicture', () => {
  it('reads an emoji or a drawing, and nothing else', () => {
    expect(parsePicture(' 🐘 ')).toEqual({ emoji: '🐘' });
    expect(parsePicture('M3 12h18')).toEqual({ paths: ['M3 12h18'] });
    expect(parsePicture('elephant')).toBeNull();
    expect(parsePicture('')).toBeNull();
  });
});
