import { File, type Directory } from 'expo-file-system';

/**
 * A JSON file that a kill in the middle of a write can't empty.
 *
 * expo-file-system writes a string straight into the file (not to a temporary one moved into
 * place), so an app killed mid-write leaves it cut short, and the next read finds nothing: for
 * WaniKani's answers waiting to be sent or the work held while offline, that's the user's work
 * gone. So each save is written twice, to `<name>.new` and then to the file itself: whichever one a
 * kill cuts short, the other is whole. Reading takes the file if it parses, else `<name>.new`.
 */
export function writeJsonSafely(dir: Directory, name: string, value: unknown): void {
  const text = JSON.stringify(value);
  for (const f of [new File(dir, `${name}.new`), new File(dir, name)]) {
    if (!f.exists) f.create();
    f.writeSync(text);
  }
}

/** What was last saved whole, or null when there's nothing (or nothing readable) there. */
export async function readJsonSafely(dir: Directory, name: string): Promise<unknown> {
  for (const f of [new File(dir, name), new File(dir, `${name}.new`)]) {
    try {
      if (f.exists) return JSON.parse(await f.text());
    } catch {
      // Cut short by a kill mid-write: the other copy is whole.
    }
  }
  return null;
}
