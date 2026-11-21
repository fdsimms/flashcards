import type { AudioPlayer } from 'expo-audio';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { sounding } from '../core/sounding';
import { haptic } from './haptics';

/**
 * For a play button: `playing` is true while the sound this button started is going, and `tap`
 * stops it then, else presses the button and runs `onPlay`. The button shows pause.fill while
 * `playing`. What reports the sound is `speechTracking` and `trackPlayer`.
 */
export function useSoundingButton() {
  const id = useRef({}).current;
  const playing = useSyncExternalStore(sounding.subscribe, () => sounding.playing(id));
  const tap = useCallback((onPlay: () => void) => {
    haptic.tap();
    if (sounding.playing(id)) { sounding.stop(); return; }
    sounding.press(id);
    onPlay();
  }, [id]);
  return { playing, tap };
}

/** Speech.speak's options with callbacks that report the voice reading to `sounding`, for the pause button. */
export function speechTracking<T extends object>(options: T): T & Pick<Speech.SpeechOptions, 'onStart' | 'onDone' | 'onStopped' | 'onError'> {
  let token = 0;
  const end = () => sounding.end(token);
  return {
    ...options,
    onStart: () => { token = sounding.begin(() => { Speech.stop().catch(() => {}); }); },
    onDone: end,
    onStopped: end,
    onError: end,
  };
}

/** Reports `player`'s playing and finishing to `sounding`, for the pause button. Returns the listener's remover. */
export function trackPlayer(player: AudioPlayer): () => void {
  let token: number | null = null;
  const sub = player.addListener('playbackStatusUpdate', (status) => {
    if (status.playing && token === null) {
      token = sounding.begin(() => { try { player.pause(); } catch { /* released */ } });
    } else if (!status.playing && token !== null) {
      sounding.end(token);
      token = null;
    }
  });
  return () => { sub.remove(); if (token !== null) sounding.end(token); };
}

/** `trackPlayer` for a player from `useAudioPlayer`. */
export function useTrackedPlayer(player: AudioPlayer) {
  useEffect(() => trackPlayer(player), [player]);
}
