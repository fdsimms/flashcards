import { expect, test } from 'vitest';
import { scrollTarget } from '../../src/reader/follow';

const bare = { height: 500, insetTop: 0 };

test('a line already in view needs no scroll', () => {
  expect(scrollTarget({ y: 300, height: 80 }, 200, bare)).toBeNull();
});

test('a line below the view scrolls up to just above it', () => {
  expect(scrollTarget({ y: 900, height: 80 }, 200, bare)).toBe(884);
});

test('a line above the view, or cut off at the bottom, scrolls too', () => {
  expect(scrollTarget({ y: 100, height: 80 }, 200, bare)).toBe(84);
  expect(scrollTarget({ y: 650, height: 80 }, 200, bare)).toBe(634);
});

test('never scrolls past the top', () => {
  expect(scrollTarget({ y: 4, height: 80 }, 50, bare)).toBe(0);
});

const underHeader = { height: 600, insetTop: 100 };

test('a line scrolled to lands below the header, not under it', () => {
  // On screen it starts at 900 - 784 = 116: the header's 100, then the margin.
  expect(scrollTarget({ y: 900, height: 80 }, 200, underHeader)).toBe(784);
});

test('a line under the header is not in view', () => {
  // The frame shows content from 250, but 250 to 350 is behind the header.
  expect(scrollTarget({ y: 300, height: 40 }, 250, underHeader)).toBe(184);
  expect(scrollTarget({ y: 360, height: 40 }, 250, underHeader)).toBeNull();
});

test('the top of the content is at minus the header, where the screen opened', () => {
  expect(scrollTarget({ y: 4, height: 80 }, 50, underHeader)).toBe(-100);
  expect(scrollTarget({ y: 20, height: 80 }, -100, underHeader)).toBeNull();
});
