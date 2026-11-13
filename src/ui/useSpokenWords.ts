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
 * The indices of the words being spoken in `words`, the line the player is on (null when none is).
 * Read once more when playback pauses, so a paused line keeps its word lit.
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
    if (!playing) return;
    const id = setInterval(read, POLL_MS);
    return () => clearInterval(id);
  }, [player, words, playing]);
  return lit;
}
