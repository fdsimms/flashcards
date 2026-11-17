import { Directory, File, Paths } from 'expo-file-system';
import type { Preload } from '../reader/preload';

/** The phone's side of Read & Listen's preloading (src/reader/preload.ts): lines kept in the caches folder. */
const folder = () => new Directory(Paths.cache, 'reader-preload');

export const preloadFiles: Preload = {
  download: async (source, name) => {
    const dir = folder();
    if (!dir.exists) dir.create({ intermediates: true });
    const file = await File.downloadFileAsync(source.uri, new File(dir, name), { headers: source.headers, idempotent: true });
    return file.uri;
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
