/**
 * Nothing in `src/` may make a date by adding days as milliseconds: `new Date(t.getTime() + days *
 * 86400000)`. Across a DST change a day is 23 or 25 hours, so the result lands an hour off, and a
 * time near the day's start moves into the study day before or after. That shipped as review due
 * dates a day early or late. Use `addCalendarDays` (`src/core/day.ts`). A measured duration
 * (a cutoff, an elapsed time) isn't a date and is fine; a line that truly means 24-hour blocks
 * says why with a `day-ms-ok:` comment on it or the line above.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');

/** `new Date(<instant> ± <n> * <a day in ms>)`, the day spelled as a number or a DAY-like name. */
const DAY_MILLIS_DATE = /new Date\([^;\n]*[-+][^;\n]*\*\s*(?:86_?400_?000|DAY_MS|DAY|dayMs|MS_PER_DAY)\b/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(name) ? [p] : [];
  });
}

function hits(text: string): number[] {
  const lines = text.split('\n');
  return lines.flatMap((line, i) => (DAY_MILLIS_DATE.test(line) && !/day-ms-ok:/.test(line) && !/day-ms-ok:/.test(lines[i - 1] ?? '') ? [i + 1] : []));
}

describe('dates made from days in milliseconds', () => {
  const files = sourceFiles(SRC);

  it('scans the source tree', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('matches every spelling it is meant to catch', () => {
    expect(DAY_MILLIS_DATE.test('new Date(now.getTime() + days * DAY)')).toBe(true);
    expect(DAY_MILLIS_DATE.test('new Date(due.getTime() - interval * 86400000)')).toBe(true);
    expect(DAY_MILLIS_DATE.test('new Date(d.getTime() + (n - 1) * 86_400_000).getDay()')).toBe(true);
    expect(DAY_MILLIS_DATE.test('new Date(nextDay + Math.floor(secs / 86400) * DAY)')).toBe(true);
    expect(DAY_MILLIS_DATE.test('now.getTime() - LOG_DAYS * 86_400_000')).toBe(false); // a cutoff, not a date
    expect(DAY_MILLIS_DATE.test('new Date(now.getTime() + secs * 1000)')).toBe(false);
    expect(hits('// day-ms-ok: why\nnew Date(t.getTime() + n * DAY)')).toEqual([]);
  });

  it('finds none in src/', () => {
    const found = files.flatMap((f) => hits(readFileSync(f, 'utf8')).map((n) => `${relative(ROOT, f)}:${n}`));
    expect(found).toEqual([]);
  });
});
