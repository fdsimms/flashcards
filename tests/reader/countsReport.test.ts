import { expect, test } from 'vitest';
import { shouldReport } from '../../src/reader/countsReport';

test('sends the first counts of a study day, and again whenever they change', () => {
  expect(shouldReport(null, { due: 3, new: 5 }, '2026-11-12')).toBe(true);
  const sent = { due: 3, new: 5, dayKey: '2026-11-12' };
  expect(shouldReport(sent, { due: 3, new: 5 }, '2026-11-12')).toBe(false);
  expect(shouldReport(sent, { due: 2, new: 5 }, '2026-11-12')).toBe(true);
  expect(shouldReport(sent, { due: 3, new: 4 }, '2026-11-12')).toBe(true);
});

test('sends unchanged counts again on a new study day, since the server shows only today’s', () => {
  expect(shouldReport({ due: 0, new: 0, dayKey: '2026-11-11' }, { due: 0, new: 0 }, '2026-11-12')).toBe(true);
});
