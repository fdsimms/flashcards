/**
 * The rating colors (`good`, `again`, `hard`, `easy`) are fills: the answer buttons, a settings
 * tile, an icon. As the color of words they're under 4.5:1 in dark mode (`good` is 3.3:1 on a
 * card, and 2.4:1 on `goodFill`). Words in those colors take the ink tokens instead: `goodInk` for
 * green, `danger` for red, `warningInk` for amber, `countNew` for blue. A line that styles text
 * (`<Text`, a `type.` text style, or a tinted `...Fill` behind it) and colors it with one of them fails here.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const UI = join(ROOT, 'src', 'ui');
const APP = join(ROOT, 'src', 'app');
const TEXT = /<Text\b|<Animated\.Text\b|\.\.\.type\.|backgroundColor: c\.\w+Fill\b/;
const RATING_COLOR = /\bcolor: [^,}]*\bc\.(good|again|hard|easy)\b/;

/** Lines allowed to keep a rating color, with the reason. */
const EXEMPT: { file: string; includes: string; why: string }[] = [
  // Title-size words fading in over the card as it's swiped, matching the button they stand for.
  // Large text needs 3:1, which both clear on the card.
  { file: join('src', 'ui', 'SwipeCard.tsx'), includes: 'rightWord]}>', why: 'large text over the card' },
  { file: join('src', 'ui', 'SwipeCard.tsx'), includes: 'leftWord]}>', why: 'large text over the card' },
];

const flagged = (line: string) => TEXT.test(line) && RATING_COLOR.test(line);

describe('rating colors as text', () => {
  const files = [UI, APP].flatMap((dir) => readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => /\.tsx?$/.test(f) && f !== 'theme.ts').map((f) => join(dir, f)));

  it('scans the screens', () => {
    expect(files.length).toBeGreaterThan(5);
    expect(files.some((f) => f.endsWith(join('reader', 'ReadLineDrill.tsx')))).toBe(true);
  });

  it('matches what it is meant to catch', () => {
    expect(flagged("<Text style={{ ...type.footnote, color: right ? c.good : c.danger }}>")).toBe(true);
    expect(flagged("<Text key={i} style={{ color: c.good, backgroundColor: c.goodFill }}>")).toBe(true);
    expect(flagged(": { color: c.good, backgroundColor: c.goodFill, fontWeight: '600' }}")).toBe(true);
    expect(flagged("<Text style={{ ...type.body, color: c.goodInk }}>")).toBe(false);
    expect(flagged("<View style={{ backgroundColor: c.good }}>")).toBe(false);
    expect(flagged("icon: { name: 'book', color: c.easy }, label: 'Read'")).toBe(false);
  });

  it('finds no text in a rating color', () => {
    const hits = files.flatMap((f) => {
      const file = relative(ROOT, f);
      return readFileSync(f, 'utf8').split('\n')
        .map((line, i) => ({ line, at: `${file}:${i + 1}` }))
        .filter(({ line }) => flagged(line) && !EXEMPT.some((e) => e.file === file && line.includes(e.includes)))
        .map(({ at }) => at);
    });
    expect(hits).toEqual([]);
  });

  it('keeps every exemption in use', () => {
    for (const e of EXEMPT) {
      const lines = readFileSync(join(ROOT, e.file), 'utf8').split('\n');
      expect(lines.some((l) => l.includes(e.includes) && flagged(l)), `${e.file}: ${e.includes}`).toBe(true);
    }
  });
});
