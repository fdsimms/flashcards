import { Directory, File, Paths } from 'expo-file-system';
import type { Preload } from '../reader/preload';
import { connection } from './connection';

/** How long a download may go without receiving anything before it's given up. */
const STALLED_MS = 10_000;

/** The phone's side of Read & Listen's preloading (src/reader/preload.ts): lines kept in the caches folder. */
const folder = () => new Directory(Paths.cache, 'reader-preload');

export const preloadFiles: Preload = {
  download: async (source, name) => {
    const dir = folder();
    if (!dir.exists) dir.create({ intermediates: true });
    if (connection.get().path === 'none') throw new Error('Offline');
    // A line that stops arriving (a dead network on a platform) is given up, so the player streams
    // or skips it instead of waiting on iOS's own minute.
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const idle = () => { clearTimeout(timer); timer = setTimeout(() => abort.abort(), STALLED_MS); };
    idle();
    try {
      const file = await File.downloadFileAsync(source.uri, new File(dir, name), { headers: source.headers, idempotent: true, signal: abort.signal, onProgress: idle });
      return file.uri;
    } finally {
      clearTimeout(timer);
    }
  },
  remove: (name) => {
    try {
      const file = new File(folder(), name);
      if (file.exists) file.delete();
    } catch {
      // It's in the caches folder, which iOS clears.
    }
  },
};
