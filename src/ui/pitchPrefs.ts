import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';

/**
 * Settings, Speaking's "Pitch line in every language": off, the pitch line shows only where a word's
 * pitch tells words apart (src/core/pitch.ts, PITCH_LANGUAGES); on, it shows on every card with a
 * recording. The phone's own setting, kept in the Keychain like the last deck, never written to Anki.
 */
const KEY = 'pitchLineEveryLanguage';

let current: boolean | undefined;
const listeners = new Set<(on: boolean) => void>();

async function load(): Promise<boolean> {
  current ??= (await SecureStore.getItemAsync(KEY).catch(() => null)) === '1';
  return current;
}

export const pitchEveryLanguage = {
  load,
  save(on: boolean): void {
    current = on;
    for (const l of listeners) l(on);
    SecureStore.setItemAsync(KEY, on ? '1' : '0').catch(() => undefined);
  },
  /** The setting, following each change; false until it's been read. */
  use(): boolean {
    const [on, setOn] = useState(current ?? false);
    useEffect(() => {
      let live = true;
      listeners.add(setOn);
      load().then((v) => { if (live) setOn(v); });
      return () => { live = false; listeners.delete(setOn); };
    }, []);
    return on;
  },
};
