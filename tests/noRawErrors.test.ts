/**
 * A screen never shows an error's own text as its message: it says what failed and what to do,
 * through `failureText` (src/core/failure.ts), which adds an unexpected error's text at the end.
 * Reading `.message` straight is fine only behind an `instanceof` check for a `Refusal` class,
 * whose message is written for a person.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');
const SCREENS = [join(SRC, 'ui'), join(SRC, 'app')];
const RAW = /\b(e|err|error|ankiError)\??\.message\b|String\((e|err|error|ankiError)\)/;

const sources = (dir: string) => readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => /\.tsx?$/.test(f)).map((f) => join(dir, f));

/** Every class that extends Refusal, read from the source so a new one counts without a change here. */
const refusals = sources(SRC).flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/class (\w+) extends Refusal\b/g)].map((m) => m[1]));
const guarded = new RegExp(`instanceof (${refusals.join('|')})\\b`);

/** A line that shows an error's raw text, unless a Refusal check guards it. */
const isRaw = (line: string) => RAW.test(line) && !guarded.test(line);

describe('error text in screens', () => {
  const files = SCREENS.flatMap(sources);

  it('scans the screens and knows the refusals', () => {
    expect(files.some((f) => f.endsWith('Review.tsx'))).toBe(true);
    expect(files.some((f) => f.endsWith('useLoadProblem.ts'))).toBe(true);
    expect(refusals).toEqual(expect.arrayContaining(['ApiError', 'NoteRefused', 'DeckRefused', 'PackageRefused']));
  });

  it('matches what it is meant to catch', () => {
    expect(isRaw("Alert.alert('Failed', e instanceof Error ? e.message : String(e));")).toBe(true);
    expect(isRaw('say(`Couldn\'t import it. ${e?.message ?? e}`);')).toBe(true);
    expect(isRaw("setError(e instanceof ApiError ? e.message : \"Couldn't load it.\");")).toBe(false);
    expect(isRaw("setError(failureText(e, { next: 'Try again.' }));")).toBe(false);
    expect(isRaw('setRetry(v.message);')).toBe(false);
  });

  it('finds no raw error text outside a refusal check', () => {
    const hits = files.flatMap((f) => readFileSync(f, 'utf8').split('\n').flatMap((line, i) => (isRaw(line) ? [`${relative(ROOT, f)}:${i + 1}`] : [])));
    expect(hits).toEqual([]);
  });
});
