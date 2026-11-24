import { createAudioPlayer, type AudioPlayer, type AudioSource } from 'expo-audio';
import { useCallback, useEffect, useRef } from 'react';
import { isBluetoothOutput } from '../../modules/audio-route';
import { needsWake, WAKE_LEAD_MS } from '../core/outputWake';
import { sounding } from '../core/sounding';

const WAKE_SOURCE: AudioSource = require('../../assets/sounds/wake-silence.wav');

/**
 * Returns `wake`, awaited before a word plays: on Bluetooth headphones that have been quiet for a
 * while it plays near silence and waits `WAKE_LEAD_MS`, so the link is awake when the word starts
 * (src/core/outputWake.ts); otherwise it returns at once. The caller checks after the await that
 * its sound is still the one wanted. The player keeps the audio session active, as the players it
 * plays before do, and is released with the screen.
 */
export function useOutputWake(): () => Promise<void> {
  const player = useRef<AudioPlayer | null>(null);
  useEffect(() => () => { player.current?.remove(); player.current = null; }, []);
  return useCallback(async () => {
    if (!needsWake(isBluetoothOutput(), sounding.quietSince(), Date.now())) return;
    try {
      player.current ??= createAudioPlayer(WAKE_SOURCE, { keepAudioSessionActive: true });
      await player.current.seekTo(0);
      player.current.play();
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, WAKE_LEAD_MS));
  }, []);
}
