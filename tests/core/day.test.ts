import { describe, expect, it } from 'vitest';
import { addCalendarDays, dayKeyOf, nextStudyDayStart, studyDayKey, studyDayStart } from '../../src/core/day';

describe('study day', () => {
  it('belongs to the day before until the reset hour', () => {
    expect(studyDayStart(new Date(2026, 10, 12, 1, 30), 4)).toEqual(new Date(2026, 10, 11, 4, 0));
    expect(studyDayStart(new Date(2026, 10, 12, 4, 0), 4)).toEqual(new Date(2026, 10, 12, 4, 0));
    expect(studyDayStart(new Date(2026, 10, 12, 23, 59), 4)).toEqual(new Date(2026, 10, 12, 4, 0));
  });
  it('treats a midnight reset as the calendar day', () => {
    expect(studyDayStart(new Date(2026, 10, 12, 0, 1), 0)).toEqual(new Date(2026, 10, 12, 0, 0));
  });
  it('ends at the next reset', () => {
    expect(nextStudyDayStart(new Date(2026, 10, 12, 1, 30), 4)).toEqual(new Date(2026, 10, 12, 4, 0));
    expect(nextStudyDayStart(new Date(2026, 10, 12, 9, 0), 4)).toEqual(new Date(2026, 10, 13, 4, 0));
  });
  it('keys days from local fields, zero-padded', () => {
    expect(dayKeyOf(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
    expect(studyDayKey(new Date(2026, 0, 6, 2, 0), 4)).toBe('2026-01-05');
  });
  it('changes days at the reset hour to the minute', () => {
    expect(studyDayKey(new Date(2026, 10, 12, 3, 59), 4)).toBe('2026-11-11');
    expect(studyDayKey(new Date(2026, 10, 12, 4, 0), 4)).toBe('2026-11-12');
    expect(studyDayKey(new Date(2026, 10, 12, 4, 1), 4)).toBe('2026-11-12');
    expect(nextStudyDayStart(new Date(2026, 10, 12, 3, 59), 4)).toEqual(new Date(2026, 10, 12, 4, 0));
    expect(nextStudyDayStart(new Date(2026, 10, 12, 4, 0), 4)).toEqual(new Date(2026, 10, 13, 4, 0));
  });
  it('holds every day of the year together, through any daylight saving change here', () => {
    // Every half hour of 2026, in whatever zone the suite runs in (`npm run test:tz` has one with
    // daylight saving): each moment is inside its own study day, the day ends where the next
    // starts, and the days are consecutive calendar days.
    for (const h of [0, 2, 4]) {
      for (let t = new Date(2026, 0, 1, 0, 15); t.getFullYear() === 2026; t = new Date(t.getTime() + 30 * 60000)) {
        const start = studyDayStart(t, h);
        const end = nextStudyDayStart(t, h);
        const at = `${t.toString()}, day starting at ${h}`;
        expect(start.getTime(), at).toBeLessThanOrEqual(t.getTime());
        expect(end.getTime(), at).toBeGreaterThan(t.getTime());
        expect(studyDayStart(end, h), at).toEqual(end);
        expect(studyDayKey(new Date(end.getTime() - 1), h), at).toBe(dayKeyOf(start));
        expect(dayKeyOf(end), at).toBe(dayKeyOf(addCalendarDays(start, 1)));
        // A day is 23 to 25 hours long.
        expect((end.getTime() - start.getTime()) / 3600000, at).toBeGreaterThanOrEqual(23);
        expect((end.getTime() - start.getTime()) / 3600000, at).toBeLessThanOrEqual(25);
      }
    }
  });
});
