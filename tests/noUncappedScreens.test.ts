/**
 * A full-screen scroller (the one a screen's large title collapses with) holds its content to a
 * readable width, so a Group or a form doesn't run edge to edge on an iPad. Spread `readable` from
 * `src/ui/theme.ts` into its `contentContainerStyle`, or give it a `maxWidth` of its own.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');

/** The opening tags of every <ScrollView ...> and <FlatList ...> in a source text, with their line. */
function scrollerTags(source: string): { tag: string; line: number }[] {
  const found: { tag: string; line: number }[] = [];
  for (const m of source.matchAll(/<(ScrollView|FlatList|SectionList)\b/g)) {
    let depth = 0;
    let i = m.index! + m[0].length;
    for (; i < source.length; i++) {
      const ch = source[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === '>' && depth === 0 && source[i - 1] !== '=') break;
    }
    found.push({ tag: source.slice(m.index!, i + 1), line: source.slice(0, m.index!).split('\n').length });
  }
  return found;
}

/** Whether a tag is a screen's main scroller, which should be capped. */
export function needsCap(tag: string): boolean {
  return /contentInsetAdjustmentBehavior="automatic"/.test(tag) && !/\bhorizontal\b/.test(tag);
}

export function isCapped(tag: string): boolean {
  return /\breadable\b/.test(tag) || /maxWidth/.test(tag);
}

describe('full-screen scrollers on a wide display', () => {
  const files = ['src/ui', 'src/app'].flatMap((dir) =>
    readdirSync(join(ROOT, dir), { recursive: true, encoding: 'utf8' }).filter((f) => /\.tsx$/.test(f)).map((f) => join(ROOT, dir, f)));

  it('scans the screens', () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.endsWith('Settings.tsx'))).toBe(true);
  });

  it('matches what it is meant to catch', () => {
    const [capped] = scrollerTags('<ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, gap: space.m }}>');
    const [bare] = scrollerTags('<ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ gap: space.m }}>');
    const [row] = scrollerTags('<ScrollView horizontal contentInsetAdjustmentBehavior="automatic">');
    expect(needsCap(capped.tag) && isCapped(capped.tag)).toBe(true);
    expect(needsCap(bare.tag) && !isCapped(bare.tag)).toBe(true);
    expect(needsCap(row.tag)).toBe(false);
  });

  it('caps every screen scroller at a readable width', () => {
    const uncapped = files.flatMap((f) => scrollerTags(readFileSync(f, 'utf8'))
      .filter(({ tag }) => needsCap(tag) && !isCapped(tag))
      .map(({ line }) => `${relative(ROOT, f)}:${line}`));
    expect(uncapped, 'Spread `readable` (src/ui/theme.ts) into contentContainerStyle').toEqual([]);
  });
});
