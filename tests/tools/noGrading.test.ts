/**
 * A Practice tool never answers, schedules or writes a card (src/tools/tools.ts): the tools' logic
 * imports nothing that does. Their screens only read the phone's voice settings, to read answers aloud.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const TOOLS = join(ROOT, 'src', 'tools');
const FORBIDDEN = /from '[^']*(core\/scheduler|core\/session|anki\/[a-zA-Z/]+|db\/[a-zA-Z]+)'/;

const files = readdirSync(TOOLS, { recursive: true, encoding: 'utf8' }).filter((f) => /\.tsx?$/.test(f)).map((f) => join(TOOLS, f));

describe('the Practice tools', () => {
  it('scans every language folder', () => {
    expect(files.some((f) => f.endsWith(join('thai', 'time.ts')))).toBe(true);
    expect(files.some((f) => f.endsWith('tools.ts'))).toBe(true);
  });

  it('matches what it is meant to catch', () => {
    expect(FORBIDDEN.test("import { review } from '../core/scheduler';")).toBe(true);
    expect(FORBIDDEN.test("import type { Repo } from '../db/repo';")).toBe(true);
    expect(FORBIDDEN.test("import { writeAnkiAnswer } from '../anki/writeback';")).toBe(true);
    expect(FORBIDDEN.test("import { LANGUAGES } from '../reader/languages';")).toBe(false);
  });

  it('imports nothing that answers, schedules or writes cards', () => {
    const offenders = files.filter((f) => FORBIDDEN.test(readFileSync(f, 'utf8'))).map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });
});
