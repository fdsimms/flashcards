import { describe, expect, it } from 'vitest';
import { daysInMonth, FIRST_YEAR, isValidDate, LAST_YEAR, randomDate, shiftMonth, weekdayOf } from '../../src/tools/date';

describe('a calendar date', () => {
  it('knows its weekday', () => {
    expect(weekdayOf({ year: 2026, month: 11, day: 12 })).toBe(4); // a Thursday
    expect(weekdayOf({ year: 2000, month: 1, day: 1 })).toBe(6); // a Saturday
    expect(weekdayOf({ year: 1969, month: 7, day: 20 })).toBe(0); // a Sunday
    expect(weekdayOf({ year: 2024, month: 2, day: 29 })).toBe(4);
  });

  it('knows how long each month is, leap years included', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it('refuses a day the month does not have', () => {
    expect(isValidDate({ year: 2026, month: 2, day: 29 })).toBe(false);
    expect(isValidDate({ year: 2026, month: 13, day: 1 })).toBe(false);
    expect(isValidDate({ year: 2024, month: 2, day: 29 })).toBe(true);
  });

  it('moves a month back or forward, keeping the day where it can', () => {
    expect(shiftMonth({ year: 2026, month: 1, day: 31 }, 1)).toEqual({ year: 2026, month: 2, day: 28 });
    expect(shiftMonth({ year: 2026, month: 1, day: 15 }, -1)).toEqual({ year: 2025, month: 12, day: 15 });
    expect(shiftMonth({ year: 2026, month: 12, day: 3 }, 1)).toEqual({ year: 2027, month: 1, day: 3 });
  });
});

describe('a random date', () => {
  it('runs from the first day of the first year to the last of the last', () => {
    expect(randomDate(undefined, () => 0)).toEqual({ year: FIRST_YEAR, month: 1, day: 1 });
    expect(randomDate(undefined, () => 0.9999999)).toEqual({ year: LAST_YEAR, month: 12, day: 31 });
  });

  it('is always a real date, and never the previous one again', () => {
    let d = randomDate();
    for (let i = 0; i < 300; i++) {
      const next = randomDate(d);
      expect(isValidDate(next)).toBe(true);
      expect(next).not.toEqual(d);
      d = next;
    }
  });
});
