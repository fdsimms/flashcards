/**
 * The theme's text colors have to be readable on what they sit on, in both modes (WCAG AA: 4.5:1
 * for text, 3:1 for icons and the quiet tier). A new color or a nudge to an old one that drops
 * below fails here, instead of being found by someone squinting at a phone in sunlight.
 *
 * theme.ts imports react-native, which vitest's node environment can't load, so the tokens are
 * read from its source, as tests/noRawColors.test.ts reads the screens.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(__dirname, '..', 'src', 'ui', 'theme.ts'), 'utf8');

function tokens(name: 'light' | 'dark'): Record<string, string> {
  const block = new RegExp(`const ${name}[^=]*= \\{([\\s\\S]*?)\\n\\};`).exec(source)?.[1] ?? '';
  return Object.fromEntries([...block.matchAll(/(\w+): '(#[0-9a-fA-F]{6})'/g)].map((m) => [m[1], m[2]]));
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe.each(['light', 'dark'] as const)('theme contrast, %s', (mode) => {
  const t = tokens(mode);

  it('reads the tokens it checks', () => {
    for (const name of ['bg', 'surface', 'text', 'textTertiary', 'accent', 'onAccent', 'again', 'hard', 'onHard']) {
      expect(t[name], name).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it.each(['text', 'textSecondary', 'accent', 'danger', 'warning', 'countNew', 'countLearn', 'countDue'])('%s reads on the background and on a surface', (name) => {
    expect(contrast(t[name], t.bg), `${name} on bg`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t[name], t.surface), `${name} on surface`).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the quiet tier at 3:1, for icons and dimmed numbers', () => {
    expect(contrast(t.textTertiary, t.bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(t.textTertiary, t.surface)).toBeGreaterThanOrEqual(3);
  });

  it('keeps the quiet tier below the readable one, so the two still differ', () => {
    expect(contrast(t.textTertiary, t.bg)).toBeLessThan(contrast(t.textSecondary, t.bg) - 1);
  });

  it("reads an amount on Counting money's notes and coins", () => {
    const block = new RegExp(`const ${mode}[^=]*= \\{([\\s\\S]*?)\\n\\};`).exec(source)?.[1] ?? '';
    const notes = [...(/cashNotes: \[([^\]]*)\]/.exec(block)?.[1] ?? '').matchAll(/#[0-9a-f]{6}/gi)].map((m) => m[0]);
    expect(notes.length).toBeGreaterThan(5);
    for (const fill of [...notes, t.cashCoin]) expect(contrast(t.onCash, fill), `onCash on ${fill}`).toBeGreaterThanOrEqual(4.5);
  });

  it('reads the label on a filled button', () => {
    expect(contrast(t.onAccent, t.accent), 'onAccent on accent').toBeGreaterThanOrEqual(4.5);
    for (const fill of ['again', 'good', 'easy']) expect(contrast(t.onRating, t[fill]), `onRating on ${fill}`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.onHard, t.hard), 'onHard on hard').toBeGreaterThanOrEqual(4.5);
  });
});
