/**
 * Nothing in `src/` may make a request outside the connection guard (src/core/connection.ts).
 *
 * A bare `fetch` or `File.downloadFileAsync` on a subway platform sits on a network that leads
 * nowhere for iOS's own minute, holding a spinner or a sync lock, and tells nothing else that the
 * servers can't be reached. Requests go through `guardedFetch` (src/ui/connection.ts); the API
 * constructors take their fetch with no default, so it has to be passed. The few that can't use it
 * are listed here with their own guard.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');

/** A call to the global fetch (not `deps.fetch(` or `guardedFetch(`), or a file download. */
const BARE_REQUEST = /(?<![\w.$])fetch\(|downloadFileAsync\(/;

const EXEMPT: Record<string, string> = {
  'src/ui/connection.ts': 'the guard itself, and its quick checks (PROBE_MS)',
  'src/anki/syncService.ts': "sync's own requests: useSync checks the server first, and each request has an idle timeout",
  'src/ui/preloadFiles.ts': 'a line download, given up when nothing arrives for STALLED_MS',
  'src/ui/fontDownloads.ts': 'a font file download, given up when nothing arrives for STALLED_MS and refused offline; the user taps it',
  'src/ui/reader/readerDownloads.ts': 'texts and lessons kept for offline, each download given up when nothing arrives for STALLED_MS',
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(name) ? [p] : [];
  });
}

describe('requests outside the connection guard', () => {
  const files = sourceFiles(SRC);

  it('scans the source tree', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('matches every spelling it is meant to catch', () => {
    expect(BARE_REQUEST.test("await fetch(url, { method: 'GET' })")).toBe(true);
    expect(BARE_REQUEST.test('File.downloadFileAsync(uri, file)')).toBe(true);
    expect(BARE_REQUEST.test('guardedFetch(url)')).toBe(false);
    expect(BARE_REQUEST.test('deps.fetch(url, init)')).toBe(false);
    expect(BARE_REQUEST.test('fetchImpl(root + path)')).toBe(false);
  });

  it('finds none in src/ but the exempt files', () => {
    const hits = files
      .map((f) => relative(ROOT, f).split('\\').join('/'))
      .filter((f) => !(f in EXEMPT) && BARE_REQUEST.test(readFileSync(join(ROOT, f), 'utf8')));
    expect(hits).toEqual([]);
  });

  it('lists no exempt file that has stopped needing it', () => {
    const stale = Object.keys(EXEMPT).filter((f) => !BARE_REQUEST.test(readFileSync(join(ROOT, f), 'utf8')));
    expect(stale).toEqual([]);
  });
});
