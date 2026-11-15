import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { loadNarrator } from '../reader/lessonStorage';

/** The narrator chosen for audio lessons ('' for the server's own), read again whenever the screen comes into view, so a choice made on the screen opened from it shows on return. */
export function useNarrator(): string {
  const [narrator, setNarrator] = useState('');
  useFocusEffect(useCallback(() => {
    let live = true;
    loadNarrator().then((n) => { if (live) setNarrator(n); });
    return () => { live = false; };
  }, []));
  return narrator;
}
