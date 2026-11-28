/**
 * A border that marks a state (picked, right, wrong) keeps one width in every state, clear when
 * off, or the box's text shifts as it changes; a quiz's answer choice spreads `answerLook`
 * (`src/ui/kit.tsx`), which does this (`.claude/rules/screens.md`). The tell is a `borderWidth`
 * chosen by a condition. The files below choose one for a box whose text can't move.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const UI = join(ROOT, 'src', 'ui');
const APP = join(ROOT, 'src', 'app');
const CHOSEN_WIDTH = /borderWidth: [^,}]*\?/;

const EXEMPT: Record<string, string> = {
  'src/ui/SkillDrill.tsx': 'progress dots of a fixed size, and rating buttons whose label is centered',
  'src/ui/StatsCalendar.tsx': 'a day cell of a fixed size, its number centered',
  'src/ui/StagePopup.tsx': 'set once per popup (a stage up or down), never changed while it shows',
  'src/ui/tools/SentencesTool.tsx': 'a progress segment that holds no text',
  'src/ui/FromZeroCards.tsx': 'a step number centered in a circle',
  'src/ui/cram/CramSay.tsx': "a chat bubble's border, set by who said it, not by a tap",
};

describe('borders that change width', () => {
  const files = [UI, APP].flatMap((dir) => readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.tsx')).map((f) => join(dir, f)));
  const rel = (f: string) => relative(ROOT, f).split('\\').join('/');

  it('scans the screens', () => {
    expect(files.length).toBeGreaterThan(5);
    expect(files.some((f) => rel(f) === 'src/ui/kit.tsx')).toBe(true);
  });

  it('matches what it is meant to catch', () => {
    expect(CHOSEN_WIDTH.test('borderWidth: on ? 2 : 0, borderColor: c.accent')).toBe(true);
    expect(CHOSEN_WIDTH.test('borderWidth: isRight || isWrong ? 1.5 : hairline,')).toBe(true);
    expect(CHOSEN_WIDTH.test("borderWidth: 2, borderColor: on ? c.accent : 'transparent'")).toBe(false);
  });

  it('every exempt file still chooses a width', () => {
    const stale = Object.keys(EXEMPT).filter((f) => !CHOSEN_WIDTH.test(readFileSync(join(ROOT, f), 'utf8')));
    expect(stale).toEqual([]);
  });

  it('finds no other border whose width follows a state', () => {
    const hits = files.map(rel).filter((f) => !(f in EXEMPT) && CHOSEN_WIDTH.test(readFileSync(join(ROOT, f), 'utf8')));
    expect(hits).toEqual([]);
  });
});
