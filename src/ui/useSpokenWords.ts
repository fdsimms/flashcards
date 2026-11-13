import type { AudioPlayer } from 'expo-audio';
import { useEffect, useState } from 'react';
import type { Word } from '../reader/api';
import { spokenWords } from '../reader/spoken';

// How often the player's position is read while a timed line plays. The player's status updates
// come every 500 ms, too coarse to follow single words, and a faster status would re-render the
// whole reader at that rate; this re-renders it only when the lit word changes.
const POLL_MS = 50;

const NONE: number[] = [];

/**
 * The indices of the words being spoken in `words`, the line sounding now (null when none is).
 */
export function useSpokenWords(player: AudioPlayer, words: Word[] | null, playing: boolean): number[] {
  const [lit, setLit] = useState<number[]>(NONE);
  useEffect(() => {
    if (!words || !words.some((w) => w.time)) {
      setLit(NONE);
      return;
    }
    const read = () => {
      const next = spokenWords(words, player.currentTime * 1000);
      setLit((prev) => (prev.length === next.length && prev.every((i, k) => i === next[k]) ? prev : next));
    };
    read();
    if (!playing) return; // buffering, or the gap between two lines of Play all: hold the word read
    const id = setInterval(read, POLL_MS);
    return () => clearInterval(id);
  }, [player, words, playing]);
  return lit;
}
