import { expect, test } from 'vitest';
import type { Progress } from '../../src/reader/api';
import { describeProgress } from '../../src/reader/progress';

const base: Progress = {
  days: 14,
  finished: 0,
  median_coverage: null,
  next: { floor: 0.95, stretch: 2 },
};

test('with nothing finished it says what to do', () => {
  expect(describeProgress(base)).toEqual({
    headline: '0 texts finished in the last 14 days',
    detail: "Finish a text to see how it's going.",
    next: 'New texts aim for at least 95% known words and 2 practice words.',
  });
});

test('it reports coverage and the target for new texts', () => {
  const p: Progress = {
    ...base,
    finished: 11,
    median_coverage: 0.967,
    next: { floor: 0.97, stretch: 1 },
  };
  expect(describeProgress(p).detail).toBe('Median 97% known words.');
  expect(describeProgress(p).next).toBe('New texts aim for at least 97% known words and 1 practice word.');
});

test('it reports the check after reading when it was taken', () => {
  const p: Progress = {
    ...base,
    finished: 4,
    median_coverage: 0.93,
    check: { texts: 3, right: 11, asked: 15 },
  };
  expect(describeProgress(p).detail).toBe('Median 93% known words. Checks after 3 texts: 73% right.');
  expect(describeProgress({ ...p, check: { texts: 0, right: 0, asked: 0 } }).detail).toBe('Median 93% known words.');
});
