/**
 * `Stack.Toolbar` keeps only its own `Stack.Toolbar.Button`, `Menu`, `Spacer` and `View` children and
 * silently drops any other element (expo-router's `processHeaderItemsForPlatform`), so a header
 * item written as `<ReviewMenu />` never appears, with no error. Review's whole menu was missing
 * that way. Build the item in a plain function called inside the toolbar (`reviewMenu(props)`),
 * or have the component return its own `<Stack.Toolbar placement>` (`LessonLanguageMenu`).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');

/** The name of every element written directly inside a `<Stack.Toolbar>`, a fragment being "". */
function toolbarChildren(raw: string): string[] {
  // Comments talk about toolbars in angle brackets too.
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const found: string[] = [];
  // A self-closing tag stays open until the scan passes its end, so a toolbar written inside another
  // tag's attribute (`<Screen toolbar={<Stack.Toolbar>...}`) is still read.
  const open: { name: string; end: number; selfClosing: boolean }[] = [];
  const tag = /<(\/?)([A-Za-z][\w.]*)?/g;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(source))) {
    while (open.length && open[open.length - 1].selfClosing && open[open.length - 1].end < m.index) open.pop();
    const name = m[2] ?? '';
    if (m[1] === '/') { open.pop(); continue; }
    // Find this tag's `>`, passing over `{...}` (an arrow's `=>` holds one).
    let i = m.index + m[0].length;
    let depth = 0;
    for (; i < source.length; i++) {
      const ch = source[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === '>' && depth <= 0) break;
    }
    if (open.length && open[open.length - 1].name === 'Stack.Toolbar' && !open[open.length - 1].selfClosing) found.push(name);
    open.push({ name, end: i, selfClosing: source[i - 1] === '/' });
  }
  return found;
}

const own = (name: string) => name.startsWith('Stack.Toolbar.');

describe('children of Stack.Toolbar', () => {
  const files = ['src/ui', 'src/app'].flatMap((dir) => readdirSync(join(ROOT, dir), { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.tsx')).map((f) => join(ROOT, dir, f)));

  it('scans the screens', () => {
    expect(files.some((f) => f.endsWith('Review.tsx'))).toBe(true);
  });

  it('matches what it is meant to catch', () => {
    expect(toolbarChildren('<Stack.Toolbar placement="right"><ReviewMenu flag={1} onX={() => go()} /></Stack.Toolbar>')).toEqual(['ReviewMenu']);
    expect(toolbarChildren('<Stack.Toolbar placement="right"><><Stack.Toolbar.Button icon="a" /></></Stack.Toolbar>')).toEqual(['']);
    expect(toolbarChildren('<Stack.Toolbar placement="right">{a ? <Stack.Toolbar.Button onPress={() => go()} /> : null}{reviewMenu({ x: 1 })}</Stack.Toolbar>')).toEqual(['Stack.Toolbar.Button']);
    expect(toolbarChildren('<Stack.Toolbar><Stack.Toolbar.Menu><Stack.Toolbar.MenuAction>Go</Stack.Toolbar.MenuAction></Stack.Toolbar.Menu></Stack.Toolbar>')).toEqual(['Stack.Toolbar.Menu']);
  });

  it('finds only the toolbar\'s own items directly inside one', () => {
    const hits = files.flatMap((f) => toolbarChildren(readFileSync(f, 'utf8')).filter((n) => !own(n)).map((n) => `${relative(ROOT, f)}: <${n || '>'}`));
    expect(hits).toEqual([]);
  });
});
