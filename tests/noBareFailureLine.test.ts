/**
 * A failure (a save, a request, a delete that didn't happen) is shown with kit's `ErrorNote`:
 * "Couldn't ..." as its title, the reason under it, Try again where there's something to retry.
 * About twenty screens had shown it as one bare red line instead. A red line stays right for what
 * to fix in what was typed (a name taken, a field left blank), so this only looks at a value that
 * a screen fills with `failureText(...)` and then draws as `danger`-colored text. A screen that
 * keeps both in one value keeps them apart instead (NoteEditor's `error`, NewDeck's `failed`).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const UI = join(ROOT, 'src', 'ui');
const APP = join(ROOT, 'src', 'app');

/** The values a file fills with failureText: `setProblem(failureText(` gives `problem`. */
function failureValues(source: string): string[] {
  return [...new Set([...source.matchAll(/\bset([A-Z]\w*)\(failureText\(/g)].map((m) => m[1].charAt(0).toLowerCase() + m[1].slice(1)))];
}

/** Those values drawn as red text rather than through ErrorNote. */
function bareFailureLines(source: string): string[] {
  return failureValues(source).filter((name) => new RegExp(`color: c\\.danger[^}]*\\}\\}>\\{${name}\\}`).test(source));
}

describe('failures shown as a bare red line', () => {
  const files = [UI, APP].flatMap((dir) => readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.tsx')).map((f) => join(dir, f)));

  it('scans the screens', () => {
    expect(files.length).toBeGreaterThan(5);
    expect(files.some((f) => f.endsWith(join('cram', 'CramPage.tsx')))).toBe(true);
  });

  it('matches what it is meant to catch', () => {
    const bare = "setProblem(failureText(e, { what: \"Couldn't save.\" }));\n{problem ? <Text style={{ ...type.subhead, color: c.danger }}>{problem}</Text> : null}";
    expect(bareFailureLines(bare)).toEqual(['problem']);
    const noted = "setProblem(failureText(e, { what: \"Couldn't save.\" }));\n{problem ? <ErrorNote message={problem} /> : null}";
    expect(bareFailureLines(noted)).toEqual([]);
    // What to fix in a field stays a red line: it isn't filled from failureText.
    const typed = "setError('Fill in the name.');\n{error ? <Text style={{ ...type.subhead, color: c.danger }}>{error}</Text> : null}";
    expect(bareFailureLines(typed)).toEqual([]);
  });

  it('finds none', () => {
    const hits = files.flatMap((f) => bareFailureLines(readFileSync(f, 'utf8')).map((name) => `${relative(ROOT, f)}: ${name}`));
    expect(hits).toEqual([]);
  });
});
