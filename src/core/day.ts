/**
 * The study day, which is not the calendar day.
 *
 * Anki's day starts at "Next day starts at" (4 AM by default), not midnight, so a session at
 * 1 AM still counts against the day before: its new cards come out of that day's limit, and a
 * review due "today" means due on that day. Everything in here takes the reset hour as a
 * parameter rather than reading a setting, so it stays testable in the `node` environment.
 *
 * Two rules this module exists to enforce (CLAUDE.md, "The study day"):
 * - Anything that decides which day something belongs to (a new-card count, whether a review
 *   is due today) goes through `studyDayStart`, never `setHours(0, 0, 0, 0)` or `toDateString()`.
 * - A day key is built from local fields (`dayKeyOf`), never cut out of `toISOString()`, which is
 *   UTC and names the wrong day far from Greenwich (`tests/noUtcDayKey.test.ts` bans it).
 */

/**
 * The start of the study day a moment falls in: the most recent `dayStartsAtHour` at or before
 * it. 1:30 AM with a 4 AM reset belongs to the day before.
 */
export function studyDayStart(date: Date, dayStartsAtHour: number): Date {
  const start = new Date(date);
  start.setHours(dayStartsAtHour, 0, 0, 0);
  if (date < start) start.setDate(start.getDate() - 1);
  return start;
}

/** The start of the next study day after the one `date` falls in. */
export function nextStudyDayStart(date: Date, dayStartsAtHour: number): Date {
  const next = studyDayStart(date, dayStartsAtHour);
  // setDate rather than adding 24 hours, so a DST change doesn't shift the hour.
  next.setDate(next.getDate() + 1);
  next.setHours(dayStartsAtHour, 0, 0, 0);
  return next;
}

/** A date's local calendar day as `YYYY-MM-DD`. Zero-padded so keys sort lexically. */
export function dayKeyOf(date: Date): string {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return `${y}-${m < 10 ? '0' : ''}${m}-${d < 10 ? '0' : ''}${d}`;
}

/** The key of the study day a moment falls in. */
export function studyDayKey(date: Date, dayStartsAtHour: number): string {
  return dayKeyOf(studyDayStart(date, dayStartsAtHour));
}
