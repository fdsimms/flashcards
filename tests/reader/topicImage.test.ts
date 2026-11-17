import { expect, test } from 'vitest';
import { MAX_IMAGE_CHARS, MAX_SIDE, base64Of, fitsServer, resizeTo } from '../../src/reader/topicImage';

test('an image is shrunk by its longer side, and left alone when it is small enough', () => {
  expect(resizeTo(4032, 3024)).toEqual({ width: MAX_SIDE });
  expect(resizeTo(3024, 4032)).toEqual({ height: MAX_SIDE });
  expect(resizeTo(1290, 2796)).toEqual({ height: MAX_SIDE });
  expect(resizeTo(1600, 1200)).toBeNull();
  expect(resizeTo(800, 600)).toBeNull();
});

test('a size the system did not report is shrunk by width', () => {
  expect(resizeTo(0, 0)).toEqual({ width: MAX_SIDE });
  expect(resizeTo(800, 0)).toEqual({ width: MAX_SIDE });
});

test('the clipboard\'s data string is cut down to its base64', () => {
  expect(base64Of('data:image/jpeg;base64,/9j/4AAQ')).toBe('/9j/4AAQ');
  expect(base64Of('/9j/4AAQ')).toBe('/9j/4AAQ');
});

test('the server takes up to its limit of base64 text, and not nothing', () => {
  expect(fitsServer('a'.repeat(MAX_IMAGE_CHARS))).toBe(true);
  expect(fitsServer('a'.repeat(MAX_IMAGE_CHARS + 1))).toBe(false);
  expect(fitsServer('')).toBe(false);
});
