/**
 * Screens take their colors from the theme (`src/ui/theme.ts`), never a literal. A hex color
 * written into a screen is the one that stays white on a dark background, or that drifts from
 * every other screen's shade. Add a token to the theme instead; it has a light and a dark value.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const UI = join(ROOT, 'src', 'ui');
const APP = join(ROOT, 'src', 'app');
const HEX = /['"`]#[0-9a-fA-F]{3,8}['"`]/;

describe('colors in screens', () => {
  const files = [UI, APP].flatMap((dir) => readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && f !== 'theme.ts').map((f) => join(dir, f)));

  it('scans the screens', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('matches what it is meant to catch', () => {
    expect(HEX.test("color: '#fff'")).toBe(true);
    expect(HEX.test('color: "#1b1b1bcc"')).toBe(true);
    expect(HEX.test('color: c.text')).toBe(false);
  });

  it('finds no hex colors outside the theme', () => {
    const hits = files.filter((f) => HEX.test(readFileSync(f, 'utf8'))).map((f) => relative(ROOT, f));
    expect(hits).toEqual([]);
  });
});
