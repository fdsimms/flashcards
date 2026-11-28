import { Paths } from 'expo-file-system';
import { readJsonSafely, writeJsonSafely } from '../media/safeJson';
import { parseShows, type RememberedShow } from './podcasts';

/**
 * The podcasts used before (podcasts.ts), in a file in the documents folder, for the add screen.
 * Kept on this phone only; an unreadable file holds none.
 */
const FILE = 'podcast-shows.json';

export async function loadShows(): Promise<RememberedShow[]> {
  try {
    return parseShows(await readJsonSafely(Paths.document, FILE));
  } catch {
    return [];
  }
}

export function saveShows(list: readonly RememberedShow[]): void {
  try {
    writeJsonSafely(Paths.document, FILE, list);
  } catch {
    // A list of shows used before is a convenience: not being able to keep it changes nothing else.
  }
}
