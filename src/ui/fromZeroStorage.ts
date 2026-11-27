import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';
import { parseFromZero, type FromZero } from '../core/fromZero';

/**
 * The languages being started from zero (src/core/fromZero.ts), kept in the Keychain like the phone's
 * other settings of its own. Read once, then held here; every screen showing them follows each save.
 */

const KEY = 'fromZero.paths';

let current: FromZero[] | undefined;
const listeners = new Set<(paths: FromZero[]) => void>();

export async function loadFromZero(): Promise<FromZero[]> {
  current ??= parseFromZero(await SecureStore.getItemAsync(KEY).catch(() => null));
  return current;
}

/** Changes the paths, once they've been read, and tells everything showing them. A failed save keeps the change for this run. */
export async function updateFromZero(change: (paths: FromZero[]) => FromZero[]): Promise<FromZero[]> {
  const next = change(await loadFromZero());
  current = next;
  for (const l of listeners) l(next);
  await SecureStore.setItemAsync(KEY, JSON.stringify(next)).catch(() => undefined);
  return next;
}

/** The paths as they are now, following every change; empty until they've been read. */
export function useFromZero(): FromZero[] {
  const [paths, setPaths] = useState<FromZero[]>(current ?? []);
  useEffect(() => {
    let live = true;
    loadFromZero().then((p) => { if (live) setPaths(p); });
    listeners.add(setPaths);
    return () => { live = false; listeners.delete(setPaths); };
  }, []);
  return paths;
}
