import { describe, expect, it } from 'vitest';
import { dayKeyOf } from '../../src/core/day';
import { forgetCard, parseDueDate, pickDays, setDueCard, studyDayAfter } from '../../src/core/reschedule';
import { newSchedState } from '../../src/core/scheduler';
import type { Card } from '../../src/core/types';
import { NOW } from '../support/fixtures';

const H = 4;
const review: Card = {
  id: 'n1:forward', noteId: 'n1', kind: 'forward', suspended: true, retired: false, buriedAt: '2026-11-11T09:00',
  sched: {
    due: new Date(2026, 10, 20, 9).toISOString(), stability: 12, difficulty: 6, elapsedDays: 0, scheduledDays: 10,
    learningSteps: 0, reps: 5, lapses: 2, state: 2, lastReview: new Date(2026, 10, 10, 9).toISOString(),
  },
};

describe('parseDueDate', () => {
  it("reads Anki's forms: days, a range either way round, and ! to reset the interval", () => {
    expect(parseDueDate('0')).toEqual({ min: 0, max: 0, forceReset: false });
    expect(parseDueDate(' 7-1! ')).toEqual({ min: 1, max: 7, forceReset: true });
    expect(parseDueDate('3!')).toEqual({ min: 3, max: 3, forceReset: true });
  });

  it('refuses anything else', () => {
    for (const s of ['', '-1', '1.5', 'tomorrow', '1-', '!3', '1 - 3']) expect(parseDueDate(s)).toBeUndefined();
  });

  it('picks every day in a range, and nothing outside it', () => {
    const spec = parseDueDate('2-4')!;
    expect([0, 0.34, 0.67, 0.999].map((r) => pickDays(spec, () => r))).toEqual([2, 3, 4, 4]);
  });
});

describe('forgetCard', () => {
  it('makes the card new, out of suspension and bury, keeping its counts unless asked', () => {
    const kept = forgetCard(review, { resetCounts: false }, NOW);
    expect(kept.sched).toEqual({ ...newSchedState(NOW), reps: 5, lapses: 2 });
    expect([kept.suspended, kept.buriedAt]).toEqual([false, undefined]);
    expect(forgetCard(review, { resetCounts: true }, NOW).sched).toMatchObject({ reps: 0, lapses: 0 });
  });
});

describe('setDueCard', () => {
  it('is due at the start of the study day that many days on, with the days since its last answer added to the interval', () => {
    const c = setDueCard(review, 3, NOW, H);
    expect(new Date(c.sched.due)).toEqual(new Date(2026, 10, 14, H));
    // Last answered 2026-11-10 09:00; the next day starts 2026-11-12 04:00: one whole day, plus 3.
    expect(c.sched).toMatchObject({ state: 2, scheduledDays: 4, stability: 12, difficulty: 6, reps: 5 });
    expect(c.suspended).toBe(false);
  });

  it('counts a 1 AM session as the day before', () => {
    const c = setDueCard(review, 0, new Date(2026, 10, 12, 1), H);
    expect(dayKeyOf(new Date(c.sched.due))).toBe('2026-11-11');
  });

  it('gives a new card the shortest interval and a starting memory', () => {
    const c = setDueCard({ ...review, sched: newSchedState(NOW) }, 5, NOW, H);
    expect(c.sched).toMatchObject({ state: 2, scheduledDays: 1, stability: 1, difficulty: 5 });
    expect(new Date(c.sched.lastReview!)).toEqual(new Date(2026, 10, 15, H));
  });
});

describe('studyDayAfter', () => {
  it('keeps the hour across a change of clocks', () => {
    // US clocks go back on 2026-11-01.
    expect(studyDayAfter(new Date(2026, 9, 30, 12), 3, H)).toEqual(new Date(2026, 10, 2, H));
  });
});
