import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';

/**
 * A deck the phone remembers for the Home Screen's quick actions (useHomeShortcuts): the one words were
 * last added to with Quick add (also where the Decks header's + opens), and the one last studied. Kept
 * in the Keychain like the phone's other settings of its own, so it never reaches Anki.
 */
function lastDeck(key: string) {
  let current: string | null | undefined;
  const listeners = new Set<(deck: string | null) => void>();
  const load = async (): Promise<string | null> => {
    current ??= await SecureStore.getItemAsync(key).catch(() => null);
    return current;
  };
  return {
    load,
    /** Remembers `deck`; a Keychain that won't take it only means the next shortcut names another. */
    save(deck: string): void {
      if (deck === current) return;
      current = deck;
      for (const l of listeners) l(deck);
      SecureStore.setItemAsync(key, deck).catch(() => undefined);
    },
    /** The deck as it is now, following every save; undefined until it's been read, null when there's none. */
    use(): string | null | undefined {
      const [deck, setDeck] = useState<string | null | undefined>(current);
      useEffect(() => {
        let live = true;
        load().then((d) => { if (live) setDeck(d); });
        listeners.add(setDeck);
        return () => { live = false; listeners.delete(setDeck); };
      }, []);
      return deck;
    },
  };
}

/** The deck words were last added to with Quick add. */
export const lastQuickAddDeck = lastDeck('quickAdd.lastDeck');

/** The deck last opened to study. */
export const lastStudiedDeck = lastDeck('study.lastDeck');
