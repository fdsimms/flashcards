import { describe, expect, it } from 'vitest';
import { dayKeyOf, nextStudyDayStart, studyDayKey, studyDayStart } from '../../src/core/day';

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
});
