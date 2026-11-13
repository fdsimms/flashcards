import { expect, test } from 'vitest';
import type { Progress } from '../../src/reader/api';
import { describeProgress } from '../../src/reader/progress';

const base: Progress = {
  days: 14,
  finished: 0,
  median_coverage: null,
  ratings: { too_easy: 0, about_right: 0, too_hard: 0, none: 0 },
  next: { floor: 0.95, stretch: 2 },
};

test('with nothing finished it says what to do', () => {
  expect(describeProgress(base)).toEqual({
    headline: '0 texts finished in the last 14 days',
    detail: "Finish a text and rate it to see how it's going.",
    next: 'New texts aim for at least 95% known words and 2 practice words.',
  });
});

test('it reports coverage and ratings', () => {
  const p: Progress = {
    ...base,
    finished: 11,
    median_coverage: 0.967,
    ratings: { too_easy: 2, about_right: 7, too_hard: 1, none: 1 },
    next: { floor: 0.97, stretch: 1 },
  };
  expect(describeProgress(p).detail).toBe('Median 97% known words. 7 of 10 rated about right.');
  expect(describeProgress(p).next).toBe('New texts aim for at least 97% known words and 1 practice word.');
});

test('it reports the check after reading when it was taken', () => {
  const p: Progress = {
    ...base,
    finished: 4,
    median_coverage: 0.93,
    ratings: { too_easy: 0, about_right: 0, too_hard: 0, none: 4 },
    check: { texts: 3, right: 11, asked: 15 },
  };
  expect(describeProgress(p).detail).toBe('Median 93% known words. Checks after 3 texts: 73% right.');
  expect(describeProgress({ ...p, check: { texts: 0, right: 0, asked: 0 } }).detail).toBe('Median 93% known words.');
});
