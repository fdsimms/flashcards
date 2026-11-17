/**
 * CLAUDE.md hands most of its architecture rules to `.claude/rules/`, one file per area, each
 * loaded only with the code its `paths:` frontmatter matches (CLAUDE.md, "Rules that load by
 * path"). This keeps that arrangement working: CLAUDE.md stays small enough to load whole into every
 * session, no rules file grows past the point where a session sees only its start, and no rules
 * file names paths that match nothing (a rule nobody would ever load).
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const RULES = join(ROOT, '.claude', 'rules');

/** CLAUDE.md's ceiling: what every session pays for, whatever it touches. */
const CLAUDE_MAX_CHARS = 25_000;
/** A rules file's ceiling, just under the 40,000 characters past which a session sees only the start. */
const RULE_MAX_CHARS = 38_000;

/** The globs in a rules file's `paths:` frontmatter. */
export function pathsOf(source: string): string[] {
  const front = /^---\n([\s\S]*?)\n---/.exec(source)?.[1] ?? '';
  return [...front.matchAll(/^\s+-\s+"([^"]+)"\s*$/gm)].map((m) => m[1]);
}

/** A `paths:` glob as a regular expression over repo-relative paths (`**` any depth, `*` within one folder). */
export function globRegex(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (glob.startsWith('**/', i)) { re += '(?:.*/)?'; i += 2; }
    else if (glob.startsWith('**', i)) { re += '.*'; i += 1; }
    else if (ch === '*') re += '[^/]*';
    else re += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

describe('globRegex', () => {
  it('matches across folders with ** and within one with *', () => {
    expect(globRegex('src/core/**').test('src/core/queue.ts')).toBe(true);
    expect(globRegex('src/core/**').test('src/core/sub/x.ts')).toBe(true);
    expect(globRegex('src/ui/Read*.tsx').test('src/ui/ReadShelf.tsx')).toBe(true);
    expect(globRegex('src/ui/Read*.tsx').test('src/ui/tools/ReadShelf.tsx')).toBe(false);
    expect(globRegex('src/ui/Read*.tsx').test('src/ui/ReadShelfxtsx')).toBe(false);
  });
});

describe('Claude rules', () => {
  const ruleFiles = readdirSync(RULES).filter((f) => f.endsWith('.md'));
  const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);

  it('keeps CLAUDE.md small enough to load into every session', () => {
    const size = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8').length;
    expect(size, `CLAUDE.md is ${size} characters. Move a section about one area into a .claude/rules/ file whose paths: cover that code.`)
      .toBeLessThanOrEqual(CLAUDE_MAX_CHARS);
  });

  it.each(ruleFiles)('%s is short enough to be read whole', (file) => {
    const size = readFileSync(join(RULES, file), 'utf8').length;
    expect(size, `${file} is ${size} characters. Split it into two rules files with the same paths:.`)
      .toBeLessThanOrEqual(RULE_MAX_CHARS);
  });

  it.each(ruleFiles)('%s names paths that match a file', (file) => {
    const globs = pathsOf(readFileSync(join(RULES, file), 'utf8'));
    expect(globs.length, `${file} has no paths: frontmatter, so it would load into every session`).toBeGreaterThan(0);
    const dead = globs.filter((g) => !tracked.some((p) => globRegex(g).test(p)));
    expect(dead, `${file}: these paths: match no tracked file`).toEqual([]);
  });

  it('is told about every rules file in CLAUDE.md', () => {
    const claude = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8');
    const missing = ruleFiles.filter((f) => !claude.includes(`\`${f}\``));
    expect(missing, 'add a row for each to the "Rules that load by path" table').toEqual([]);
  });
});
