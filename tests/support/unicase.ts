import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The app's unicase collation (modules/anki-unicase) built as a SQLite extension for Node, so the
 * tests write Anki's collated tables through the same C the phone runs. Built once per change to
 * its sources, with the system C compiler and SQLite headers (CI installs libsqlite3-dev). Null
 * when it can't be built locally; in CI that's an error, so those tests never skip there unseen.
 */

const MODULE = join(__dirname, '..', '..', 'modules', 'anki-unicase', 'ios');
const SOURCES = [join(__dirname, 'unicase', 'extension.c'), join(MODULE, 'unicase_compare.c'), join(MODULE, 'unicase_table.inc')];

let built: string | null | undefined;

export function unicaseExtension(): string | null {
  if (built !== undefined) return built;
  const hash = createHash('sha1');
  for (const f of SOURCES) hash.update(readFileSync(f));
  const out = join(tmpdir(), `franki-unicase-${hash.digest('hex').slice(0, 12)}.so`);
  if (existsSync(out)) return (built = out);
  // Test files run in parallel workers, each building it if it isn't there yet. Built under a name
  // of its own and renamed into place (which is atomic), so no worker ever loads a half-written file.
  const partial = `${out}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    execFileSync('cc', ['-O2', '-fPIC', '-shared', SOURCES[0], '-o', partial], { stdio: 'pipe' });
    renameSync(partial, out);
    return (built = out);
  } catch (e) {
    rmSync(partial, { force: true });
    if (process.env.CI) throw new Error(`Couldn't build the unicase extension: ${(e as Error).message}`);
    return (built = null);
  }
}

/** Node's SQLite with the collation loaded. */
export async function sqliteWithUnicase(path: string) {
  const ext = unicaseExtension();
  if (!ext) throw new Error('unicase extension unavailable');
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path, { allowExtension: true });
  db.loadExtension(ext);
  db.enableLoadExtension(false);
  return db;
}
