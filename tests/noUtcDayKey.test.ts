/**
 * Nothing in `src/` may cut a day key out of `toISOString()`.
 *
 * `toISOString()` is UTC and a study day is local, so the two agree only while the instant stays
 * on the same calendar date in both. The mismatch is invisible in a UTC run (an agent's sandbox,
 * most of Europe) and shows only far from Greenwich, and a behavioral test can't catch it in a
 * suite that runs in one zone. So this bans the pattern outright; use `dayKeyOf` or `studyDayKey`
 * (`src/core/day.ts`).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');

/** `.toISOString().slice(0, 10)` and its `substring`/`substr`/`split('T')` spellings. */
const UTC_DAY_KEY = /toISOString\(\)\s*\.(?:(?:slice|substring|substr)\(\s*0\s*,\s*10\s*\)|split\(\s*['"]T['"]\s*\))/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(name) ? [p] : [];
  });
}

describe('UTC day keys', () => {
  const files = sourceFiles(SRC);

  it('scans the source tree', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('matches every spelling it is meant to catch', () => {
    // Guards the pattern itself, so the check can't go quietly vacuous.
    expect(UTC_DAY_KEY.test('d.toISOString().slice(0, 10)')).toBe(true);
    expect(UTC_DAY_KEY.test('d.toISOString().substring(0,10)')).toBe(true);
    expect(UTC_DAY_KEY.test("d.toISOString().split('T')[0]")).toBe(true);
    expect(UTC_DAY_KEY.test('d.toISOString()')).toBe(false);
  });

  it('finds none in src/', () => {
    const hits = files.filter((f) => UTC_DAY_KEY.test(readFileSync(f, 'utf8'))).map((f) => relative(ROOT, f));
    expect(hits).toEqual([]);
  });
});
