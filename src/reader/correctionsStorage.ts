import { Paths } from 'expo-file-system';
import { readJsonSafely, writeJsonSafely } from '../media/safeJson';
import { parseKept, type KeptCorrection } from './corrections';

/**
 * The corrections kept from rehearsals (corrections.ts), in a file in the documents folder, beside
 * the work held offline (src/ui/held.ts). Kept on this phone only. An unreadable file holds nothing;
 * a failed write throws, so Keep these can say so instead of looking kept.
 */
const FILE = 'kept-corrections.json';

export async function loadKept(): Promise<KeptCorrection[]> {
  try {
    return parseKept(await readJsonSafely(Paths.document, FILE));
  } catch {
    return [];
  }
}

export function saveKept(list: readonly KeptCorrection[]): void {
  writeJsonSafely(Paths.document, FILE, list);
}
