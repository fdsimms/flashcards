import { expect, test } from 'vitest';
import type { Cram } from '../../src/core/cram';
import { cramsReport, MAX_REPORTED_CRAMS } from '../../src/core/cramsReport';

// Fixtures are local times; the study day starts at 4 AM.
const NOW = new Date(2026, 10, 18, 12, 0);
const H = 4;

function cram(over: Partial<Cram> = {}): Cram {
  return { id: 'thai-lesson-2026-11-20', name: 'Thai lesson', date: '2026-11-20', createdAt: new Date(2026, 10, 10, 9).toISOString(), addNew: false, rounds: [], ...over };
}

test('an open cram is sent with its day, when its day ends, and nothing practiced or finished yet', () => {
  expect(cramsReport([cram()], NOW, H)).toEqual([
    {
      id: 'thai-lesson-2026-11-20',
      name: 'Thai lesson',
      date: '2026-11-20',
      // The study day after the 20th starts at 4 AM on the 21st.
      ends_at: new Date(2026, 10, 21, 4).toISOString(),
      practiced_at: null,
      finished_at: null,
    },
  ]);
});

test('practiced_at is the latest round, whatever order the rounds are in', () => {
  const late = new Date(2026, 10, 18, 9).toISOString();
  const early = new Date(2026, 10, 17, 20).toISOString();
  const rounds = [{ finishedAt: late, noteIds: [], missed: [] }, { finishedAt: early, noteIds: [], missed: [] }];
  expect(cramsReport([cram({ rounds })], NOW, H)[0].practiced_at).toBe(late);
});

test('a cram whose day is over but not finished is still sent, so its check-off task can be written', () => {
  expect(cramsReport([cram({ date: '2026-11-16', id: 'old' })], NOW, H).map((c) => c.id)).toEqual(['old']);
});

test('a cram finished today is sent with when, and one finished before today is left out', () => {
  // 3 AM on the 18th is still the 17th's study day.
  const yesterday = cram({ id: 'a', finishedAt: new Date(2026, 10, 18, 3).toISOString() });
  const today = cram({ id: 'b', finishedAt: new Date(2026, 10, 18, 5).toISOString() });
  const got = cramsReport([yesterday, today], NOW, H);
  expect(got.map((c) => c.id)).toEqual(['b']);
  expect(got[0].finished_at).toBe(today.finishedAt);
});

test('the soonest come first, and no more than the server takes', () => {
  const later = cram({ id: 'later', date: '2026-12-01' });
  const sooner = cram({ id: 'sooner', date: '2026-11-19' });
  expect(cramsReport([later, sooner], NOW, H).map((c) => c.id)).toEqual(['sooner', 'later']);
  const many = Array.from({ length: MAX_REPORTED_CRAMS + 5 }, (_, i) => cram({ id: `c${String(i).padStart(2, '0')}` }));
  expect(cramsReport(many, NOW, H)).toHaveLength(MAX_REPORTED_CRAMS);
});
