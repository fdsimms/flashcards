/**
 * A reading drawn as a bar (a share known, a chance of remembering, how far a lesson has played) is
 * kit's `Meter`, and a session's progress is `ProgressBar`. Hand-built bars drifted into three
 * heights and four corner styles before they were shared. The tell is a fill whose width is a
 * percentage worked out in a template string. The files below draw something else that way.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const UI = join(ROOT, 'src', 'ui');
const APP = join(ROOT, 'src', 'app');
const PERCENT_WIDTH = /width: `\$\{[^`]*\}%`/;

const EXEMPT: Record<string, string> = {
  'src/ui/kit.tsx': 'Meter and ProgressBar themselves',
  'src/ui/Skeleton.tsx': "a placeholder's width while loading, not a reading",
  'src/ui/reader/LessonScrubber.tsx': 'a scrubber to drag, with its own thumb',
  'src/ui/reader/LineScrubber.tsx': 'a scrubber to drag, with its own thumb',
  'src/ui/reader/ReadCastKind.tsx': 'a range between two marks on a slider',
  'src/ui/reader/ReadInputTime.tsx': 'reading and listening stacked in one bar',
  'src/ui/WordsKnown.tsx': 'mature and young words stacked in one bar',
  'src/ui/reader/ReadLevel.tsx': 'a scale with marks at 90% and 98% that reach past the bar',
};

describe('hand-built meters', () => {
  const files = [UI, APP].flatMap((dir) => readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.tsx')).map((f) => join(dir, f)));
  const rel = (f: string) => relative(ROOT, f).split('\\').join('/');

  it('scans the screens', () => {
    expect(files.length).toBeGreaterThan(5);
    expect(files.some((f) => rel(f) === 'src/ui/MemoryStrength.tsx')).toBe(true);
  });

  it('matches what it is meant to catch', () => {
    expect(PERCENT_WIDTH.test("<View style={{ width: `${percent}%`, height: '100%' }} />")).toBe(true);
    expect(PERCENT_WIDTH.test('<Meter value={percent / 100} color={c.warning} />')).toBe(false);
    expect(PERCENT_WIDTH.test("maxWidth: '85%'")).toBe(false);
  });

  it('every exempt file still draws a bar that way', () => {
    const stale = Object.keys(EXEMPT).filter((f) => !PERCENT_WIDTH.test(readFileSync(join(ROOT, f), 'utf8')));
    expect(stale).toEqual([]);
  });

  it('finds no other bar built by hand', () => {
    const hits = files.map(rel).filter((f) => !(f in EXEMPT) && PERCENT_WIDTH.test(readFileSync(join(ROOT, f), 'utf8')));
    expect(hits).toEqual([]);
  });
});
