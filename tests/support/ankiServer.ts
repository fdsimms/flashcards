import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A real Anki sync server and a real Anki client, for the live sync tests. Both come from the
 * `anki` Python package (`pip install anki`), named by FRANKI_ANKI_PYTHON (that environment's
 * python). Without it the live tests are skipped: CI doesn't have Anki.
 */

export const ANKI_PYTHON = process.env.FRANKI_ANKI_PYTHON;
const FIXTURES = join(__dirname, '..', 'fixtures', 'anki');

export interface AnkiServer {
  url: string;
  stop(): void;
}

export async function startAnkiServer(): Promise<AnkiServer> {
  const base = mkdtempSync(join(tmpdir(), 'anki-sync-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const proc: ChildProcess = spawn(ANKI_PYTHON!, ['-m', 'anki.syncserver'], {
    env: { ...process.env, SYNC_USER1: 'user:pass', SYNC_BASE: base, SYNC_HOST: '127.0.0.1', SYNC_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('sync server did not start')), 15000);
    const watch = (b: Buffer) => { if (b.toString().includes('listening')) { clearTimeout(timer); resolve(); } };
    proc.stdout!.on('data', watch);
    proc.stderr!.on('data', watch);
    proc.on('exit', (code) => reject(new Error(`sync server exited (${code})`)));
  });
  return { url: `http://127.0.0.1:${port}/`, stop: () => proc.kill() };
}

/** Anki's own integrity check (with its collation) on a copy of a collection file: ['ok'] when sound. */
export function ankiIntegrity(path: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'anki-check-'));
  const copy = join(dir, 'collection.anki2');
  copyFileSync(path, copy);
  const out = execFileSync(ANKI_PYTHON!, ['-I', join(FIXTURES, 'sync-device.py'), copy, 'http://unused/', 'integrity'], { encoding: 'utf8' });
  return JSON.parse(out.trim().split('\n').at(-1)!).integrity;
}

/** A device running Anki: its own collection, started as a copy of the fixture. */
export function ankiDevice(server: AnkiServer, name: string) {
  const dir = mkdtempSync(join(tmpdir(), `anki-${name}-`));
  const path = join(dir, 'collection.anki2');
  copyFileSync(join(FIXTURES, 'collection.anki2'), path);
  return {
    path,
    /** Runs sync-device.py commands; `+` separates them. Returns its JSON output. */
    run(...args: string[]): Record<string, any> {
      const out = execFileSync(ANKI_PYTHON!, ['-I', join(FIXTURES, 'sync-device.py'), path, server.url, ...args], { encoding: 'utf8' });
      return JSON.parse(out.trim().split('\n').at(-1)!);
    },
  };
}
