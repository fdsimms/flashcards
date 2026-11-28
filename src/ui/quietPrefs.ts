import * as SecureStore from 'expo-secure-store';
import { useEffect, useRef, useState } from 'react';
import { parseQuiet, quietActive, type QuietPrefs } from '../core/quietMode';

/**
 * Quiet mode's phone side (src/core/quietMode.ts has the rules): the setting, kept in the Keychain like
 * the other settings that are this phone's own, so it stays out of a backup and never reaches Anki.
 * The deck list and the review screen read it into `queueInput`'s `held`.
 */

const KEY = 'quiet.prefs';

let current: QuietPrefs | null | undefined;
const listeners = new Set<(prefs: QuietPrefs | null) => void>();

export async function loadQuiet(): Promise<QuietPrefs | null> {
  if (current === undefined) current = parseQuiet(await SecureStore.getItemAsync(KEY).catch(() => null));
  return current;
}

/**
 * Starts, changes or (with null) ends Quiet mode, and tells everything showing it at once. A Keychain that
 * won't take it only means the mode is gone the next time the app opens, so it isn't an error to show.
 */
export function saveQuiet(prefs: QuietPrefs | null): void {
  current = prefs;
  for (const l of listeners) l(prefs);
  (prefs ? SecureStore.setItemAsync(KEY, JSON.stringify(prefs)) : SecureStore.deleteItemAsync(KEY)).catch(() => undefined);
}

/**
 * The mode as it is now: whether it's on, and what was chosen. It follows every save and turns itself off
 * when its time is up. Off until the setting has been read, which only delays a held card by a frame.
 */
export function useQuiet(): { prefs: QuietPrefs | null; active: boolean } {
  const [prefs, setPrefs] = useState<QuietPrefs | null | undefined>(current);
  const [, tick] = useState(0);
  useEffect(() => {
    let live = true;
    loadQuiet().then((p) => { if (live) setPrefs(p); });
    listeners.add(setPrefs);
    return () => { live = false; listeners.delete(setPrefs); };
  }, []);
  const until = prefs?.until;
  useEffect(() => {
    if (!until) return;
    const id = setTimeout(() => tick((n) => n + 1), Math.max(0, new Date(until).getTime() - Date.now()) + 50);
    return () => clearTimeout(id);
  }, [until]);
  return { prefs: prefs ?? null, active: quietActive(prefs, new Date()) };
}

/** Counts the deck list again when Quiet mode starts or ends (AppContext calls this in one line). */
export function useQuietRefresh(refresh: () => Promise<void>): void {
  const { active } = useQuiet();
  const latest = useRef(refresh);
  latest.current = refresh;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    void latest.current();
  }, [active]);
}
