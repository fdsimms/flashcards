import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { AppState } from 'react-native';

/**
 * `useFocusEffect` for a read of something that changes elsewhere (a server's counts, the study
 * day): `read` runs when the screen comes into view, and again each time the app comes back to the
 * foreground on it. Focus alone isn't enough, since a screen that was showing when the app went to
 * the background doesn't gain focus again when it returns, and what it shows would stay as it was
 * hours ago, with nothing to say it's old.
 *
 * Only while the screen is in view, as with focus. `read` may return a cleanup, which runs before
 * the next read and when the screen leaves view. Wrap `read` in `useCallback`, as for `useFocusEffect`.
 */
export function useReadWhileShown(read: () => void | (() => void)): void {
  useFocusEffect(useCallback(() => {
    let cleanup = read();
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      cleanup?.();
      cleanup = read();
    });
    return () => {
      sub.remove();
      cleanup?.();
    };
  }, [read]));
}
