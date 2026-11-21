import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';

/**
 * The deck words were last added to with Quick add: the deck it opens on from the Decks header, and the
 * Home Screen's "Add to" quick action (useHomeShortcuts). Kept in the Keychain like the phone's other
 * settings of its own, so it never reaches Anki.
 */

const KEY = 'quickAdd.lastDeck';

let current: string | null | undefined;
const listeners = new Set<(deck: string | null) => void>();

export async function loadLastQuickAddDeck(): Promise<string | null> {
  current ??= await SecureStore.getItemAsync(KEY).catch(() => null);
  return current;
}

/** Remembers `deck`; a Keychain that won't take it only means the next Quick add starts elsewhere. */
export function saveLastQuickAddDeck(deck: string): void {
  current = deck;
  for (const l of listeners) l(deck);
  SecureStore.setItemAsync(KEY, deck).catch(() => undefined);
}

/** The deck as it is now, following every save; undefined until it's been read, null when there's none. */
export function useLastQuickAddDeck(): string | null | undefined {
  const [deck, setDeck] = useState<string | null | undefined>(current);
  useEffect(() => {
    let live = true;
    loadLastQuickAddDeck().then((d) => { if (live) setDeck(d); });
    listeners.add(setDeck);
    return () => { live = false; listeners.delete(setDeck); };
  }, []);
  return deck;
}
