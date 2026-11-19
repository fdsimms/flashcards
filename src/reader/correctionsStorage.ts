import { File, Paths } from 'expo-file-system';
import { parseKept, type KeptCorrection } from './corrections';

/**
 * The corrections kept from rehearsals (corrections.ts), in a file in the documents folder, beside
 * the work held offline (src/ui/held.ts). Kept on this phone only. An unreadable file holds nothing;
 * a failed write throws, so Keep these can say so instead of looking kept.
 */
const file = () => new File(Paths.document, 'kept-corrections.json');

export async function loadKept(): Promise<KeptCorrection[]> {
  try {
    const f = file();
    return parseKept(f.exists ? JSON.parse(await f.text()) : null);
  } catch {
    return [];
  }
}

export function saveKept(list: readonly KeptCorrection[]): void {
  const f = file();
  if (!f.exists) f.create();
  f.writeSync(JSON.stringify(list));
}
