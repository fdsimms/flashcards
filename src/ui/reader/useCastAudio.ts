import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutputWake } from '../useOutputWake';
import { failureText } from '../../core/failure';
import type { Api } from '../../reader/api';

/**
 * Plays what Read & Listen's Story characters screens ask the server to speak: a sample of a voice
 * and pitch, or a scene in the voices a story would give. Each is asked for once and kept in the
 * cache folder under `key` (`audioKey`, which has every voice and pitch in it), so tapping it again
 * plays at once. A tap while one is still loading takes over: only the latest one plays.
 */
export function useCastAudio(api: Api | null) {
  const player = useRef<AudioPlayer | null>(null);
  const latest = useRef(0);
  const wake = useOutputWake();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // Bumping `latest` too, so a sample still loading when the screen goes never plays after it.
  useEffect(() => () => { latest.current++; player.current?.remove(); player.current = null; }, []);
  const play = useCallback(async (key: string, load: () => Promise<Uint8Array>) => {
    if (!api) return;
    const mine = ++latest.current;
    setError(undefined);
    setBusy(true);
    player.current?.pause();
    try {
      const file = new File(Paths.cache, `cast-${key}.mp3`);
      if (!file.exists) {
        const bytes = await load();
        file.create({ overwrite: true });
        await file.write(bytes);
      }
      if (mine !== latest.current) return;
      // Bluetooth headphones that have been quiet lose the start of the next sound (useOutputWake).
      await wake();
      if (mine !== latest.current) return;
      player.current ??= createAudioPlayer();
      player.current.replace({ uri: file.uri });
      player.current.play();
    } catch (e) {
      if (mine === latest.current) setError(failureText(e, { what: "Couldn't play that.", next: 'Try again.' }));
    } finally {
      if (mine === latest.current) setBusy(false);
    }
  }, [api, wake]);
  return { play, busy, error };
}
