import { Directory, File, Paths } from 'expo-file-system';
import { fileUriToPath } from '../db/backup';
import type { ByteSink, ByteSource } from './package';

/**
 * The phone's side of the package code: files as byte streams, and where Franki keeps the Anki
 * collection. Native-only (expo-file-system), so it has no tests; everything it feeds is tested
 * over Node files in tests/anki/.
 */

export function ankiFolder(): Directory {
  const dir = new Directory(Paths.document, 'anki');
  dir.create({ idempotent: true, intermediates: true });
  return dir;
}

/** The Anki collection Franki keeps and writes answers into. */
export function keptCollectionFile(): File {
  return new File(ankiFolder(), 'collection.anki2');
}

/** A fresh, empty working folder under the cache, for one import or export. */
export function workFolder(name: string): Directory {
  const dir = new Directory(Paths.cache, name);
  if (dir.exists) dir.delete();
  dir.create({ intermediates: true });
  return dir;
}

export function pathOf(file: File): string {
  return fileUriToPath(file.uri);
}

export function fileSource(file: File): ByteSource {
  const handle = file.open();
  let done = false;
  return {
    async read(max) {
      if (done) return null;
      const bytes = await handle.readBytes(max);
      if (bytes.length === 0) { done = true; handle.close(); return null; }
      return bytes;
    },
  };
}

export function fileSink(file: File): ByteSink {
  file.create({ overwrite: true, intermediates: true });
  const handle = file.open();
  return {
    write: (bytes) => handle.writeBytes(bytes),
    async close() { handle.close(); },
  };
}
