/**
 * Read & Listen never grades a card from exposure and never adds one without an approval step
 * (CLAUDE.md, Read & Listen). Its code, logic and screens alike, imports nothing that answers,
 * schedules or writes cards and notes: not the scheduler, not the Anki writeback, not the repo.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const READER = join(ROOT, 'src', 'reader');
const UI = join(ROOT, 'src', 'ui');
// Anything that answers, schedules or writes cards and notes.
const FORBIDDEN = /from '[^']*(core\/scheduler|core\/session|anki\/writeback|anki\/noteWrites|anki\/noteService|db\/[a-zA-Z]+)'/;

describe('Read & Listen', () => {
  const files = [
    ...readdirSync(READER).filter((f) => /\.tsx?$/.test(f)).map((f) => join(READER, f)),
    ...readdirSync(UI).filter((f) => /^Read[A-Z]?.*\.tsx$/.test(f)).map((f) => join(UI, f)),
  ];

  it('scans its logic and its screens', () => {
    expect(files.some((f) => f.endsWith('Reader.tsx'))).toBe(true);
    expect(files.some((f) => f.endsWith('ReadTopics.tsx'))).toBe(true);
    expect(files.some((f) => f.endsWith('session.ts'))).toBe(true);
  });

  it('matches what it is meant to catch', () => {
    expect(FORBIDDEN.test("import { review } from '../core/scheduler';")).toBe(true);
    expect(FORBIDDEN.test("import { writeAnkiAnswer } from '../anki/writeback';")).toBe(true);
    expect(FORBIDDEN.test("import type { Repo } from '../db/repo';")).toBe(true);
    expect(FORBIDDEN.test("import { startSession } from '../reader/session';")).toBe(false);
  });

  it('imports nothing that grades or writes cards', () => {
    const hits = files.filter((f) => FORBIDDEN.test(readFileSync(f, 'utf8'))).map((f) => relative(ROOT, f));
    expect(hits).toEqual([]);
  });
});
