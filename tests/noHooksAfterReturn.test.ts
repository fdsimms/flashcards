/**
 * A component or hook calls its hooks before any early return. A hook below `if (!x) return ...`
 * runs on some renders and not others, and React throws "Rendered more hooks than during the
 * previous render" the first time the return isn't taken: the screen crashes as soon as its data
 * loads. There's no ESLint here and no screen tests, so nothing else would catch it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const UI = join(ROOT, 'src', 'ui');
const APP = join(ROOT, 'src', 'app');

const HOOK = /^use[A-Z0-9]/;

/** The hook a call calls, if it's one: useState(), React.useState(). */
function hookName(call: ts.CallExpression): string | undefined {
  const callee = call.expression;
  const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;
  return name && HOOK.test(name) ? name : undefined;
}

/** Whether `node` holds something matching `found`, not counting what's inside nested functions. */
function contains(node: ts.Node, found: (n: ts.Node) => boolean): boolean {
  let hit = false;
  const visit = (n: ts.Node) => {
    if (hit || ts.isFunctionLike(n)) return;
    if (found(n)) hit = true;
    else ts.forEachChild(n, visit);
  };
  ts.forEachChild(node, visit);
  return hit || found(node);
}

/** Hooks called in a function's own body after a statement that can return. */
function lateHooks(body: ts.Block, file: ts.SourceFile): { line: number; hook: string }[] {
  const out: { line: number; hook: string }[] = [];
  let returned = false;
  for (const statement of body.statements) {
    if (returned) {
      const visit = (n: ts.Node) => {
        if (ts.isFunctionLike(n)) return;
        if (ts.isCallExpression(n)) {
          const hook = hookName(n);
          if (hook) out.push({ line: file.getLineAndCharacterOfPosition(n.getStart(file)).line + 1, hook });
        }
        ts.forEachChild(n, visit);
      };
      visit(statement);
    }
    if (contains(statement, ts.isReturnStatement)) returned = true;
  }
  return out;
}

/** A component (capitalized) or a hook (use...), as a declaration or a const arrow or function. */
function nameOf(fn: ts.FunctionLikeDeclaration): string | undefined {
  if (fn.name && ts.isIdentifier(fn.name)) return fn.name.text;
  const parent = fn.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  return undefined;
}

function hooksAfterReturn(source: string, fileName = 'file.tsx'): { fn: string; line: number; hook: string }[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: { fn: string; line: number; hook: string }[] = [];
  const visit = (n: ts.Node) => {
    if ((ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && n.body && ts.isBlock(n.body)) {
      const fn = nameOf(n);
      if (fn && (/^[A-Z]/.test(fn) || HOOK.test(fn))) for (const hit of lateHooks(n.body, file)) out.push({ fn, ...hit });
    }
    ts.forEachChild(n, visit);
  };
  visit(file);
  return out;
}

describe('hooks before an early return', () => {
  // Folders too: src/ui/tools/ holds screens, src/app/(tabs)/ routes.
  const files = [UI, APP].flatMap((dir) => readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => /\.tsx?$/.test(f)).map((f) => join(dir, f)));

  it('scans the screens, their hooks and the routes', () => {
    expect(files.some((f) => f.endsWith('FormsDrill.tsx'))).toBe(true);
    expect(files.some((f) => f.endsWith('useReader.ts'))).toBe(true);
    expect(files.some((f) => f.endsWith(join('tools', 'TimeTool.tsx')))).toBe(true);
  });

  it('catches a hook below an early return, and nothing else', () => {
    const late = `export function Drill({ prompts }) {
  const [i, setI] = useState(0);
  if (!prompts) return <Loading />;
  const written = useRef(null);
  return <View />;
}`;
    expect(hooksAfterReturn(late)).toEqual([{ fn: 'Drill', line: 4, hook: 'useRef' }]);
    expect(hooksAfterReturn(late.replace('useRef(null)', 'React.useRef(null)'))[0]?.hook).toBe('useRef');
    // In a block of its own, and in a hook as well as a component.
    expect(hooksAfterReturn(`function useThing(x) { if (!x) { return null; } return useMemo(() => x, [x]); }`, 'a.ts')).toEqual([{ fn: 'useThing', line: 1, hook: 'useMemo' }]);
    // A hook above the return, a return inside a callback, and a helper defined after it are all fine.
    expect(hooksAfterReturn(`export function Fine({ x }) {
  const y = useMemo(() => x, [x]);
  const pick = () => { if (!x) return; };
  if (!y) return null;
  const helper = () => useless();
  function useLater() { return useState(0); }
  return <View onPress={() => setTimeout(() => { useless(); })} />;
}`)).toEqual([]);
    // A plain function that isn't a component or a hook isn't checked.
    expect(hooksAfterReturn(`function summary(q) { if (!q) return ''; return useless(q); }`, 'a.ts')).toEqual([]);
  });

  it('finds none in the app', () => {
    const hits = files.flatMap((f) => hooksAfterReturn(readFileSync(f, 'utf8'), f).map((h) => `${relative(ROOT, f)}:${h.line} ${h.fn} calls ${h.hook} after an early return`));
    expect(hits).toEqual([]);
  });
});
