import { useFocusEffect } from 'expo-router';
import * as Speech from 'expo-speech';
import { useCallback, useMemo, useRef } from 'react';
import type { TtsTag } from '../core/tts';
import { lineSpeech, tagSpeech, wordSpeech, type PhoneVoice, type VoiceSettings } from '../core/voices';
import type { Repo } from '../db/repo';
import { useOutputWake } from './useOutputWake';
import { speechTracking } from './useSoundingButton';
import { NORMAL_RATE, SLOW_RATE } from '../reader/playbackRate';

/**
 * Stops the phone's voice only if it is speaking. Stopping an idle synthesizer right before a sound
 * starts can pull the audio session out from under it, so the sound that follows never plays: ask
 * the voice rather than stop it blind. Every "stop, then play" goes through this.
 */
export async function stopSpeechIfRunning(): Promise<void> {
  if (!(await Speech.isSpeakingAsync().catch(() => false))) return;
  await Speech.stop().catch(() => {});
  // iOS drops an utterance spoken the instant after a stop, so a word answered quickly after the
  // last one stayed silent at random. Wait until the voice reports it is quiet (at most STOP_WAIT_MS).
  for (let waited = 0; waited < STOP_WAIT_MS; waited += STOP_POLL_MS) {
    if (!(await Speech.isSpeakingAsync().catch(() => false))) break;
    await new Promise((resolve) => setTimeout(resolve, STOP_POLL_MS));
  }
  await new Promise((resolve) => setTimeout(resolve, STOP_POLL_MS));
}
const STOP_WAIT_MS = 400;
const STOP_POLL_MS = 30;

// The latest thing this module asked the voice to say. A retry only runs while its own request is still the latest.
let latestSpeech = 0;
const START_WAIT_MS = 600;
const START_RETRIES = 2;

/**
 * Speaks `text`, and speaks it again if the voice never starts. iOS sometimes takes an utterance and
 * stays silent (no start, no error, nothing queued), which showed as a word that didn't autoplay at
 * random. The voice reports `onStart` when it begins, so a request that is neither started nor
 * speaking after a moment was dropped. A newer request, or a stop, ends the retrying.
 */
function speakUntilStarted(text: string, options: Parameters<typeof speechTracking>[0], retries = START_RETRIES): void {
  const mine = ++latestSpeech;
  const attempt = (left: number) => {
    const tracked = speechTracking(options);
    let heard = false;
    Speech.speak(text, {
      ...tracked,
      onStart: () => { heard = true; tracked.onStart?.(); },
      onDone: () => { heard = true; tracked.onDone?.(); },
      onStopped: () => { heard = true; tracked.onStopped?.(); },
      onError: (e) => { heard = true; tracked.onError?.(e); },
    });
    setTimeout(async () => {
      if (heard || left <= 0 || mine !== latestSpeech) return;
      if (await Speech.isSpeakingAsync().catch(() => true)) return;
      if (mine !== latestSpeech) return;
      await Speech.stop().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, STOP_POLL_MS));
      if (mine !== latestSpeech) return;
      attempt(left - 1);
    }, START_WAIT_MS);
  };
  attempt(retries);
}

/**
 * Reading aloud with the phone's voices, in the voice and at the speed chosen for each language
 * (Settings, Voices). The phone's voices and the choices are loaded whenever the screen comes into
 * view, so a voice changed on a screen opened from it (Review's Play button) is used on return.
 */
export function usePhoneSpeech(repo: Repo) {
  const voices = useRef<PhoneVoice[]>([]);
  const settings = useRef<VoiceSettings>({});
  useFocusEffect(useCallback(() => {
    Speech.getAvailableVoicesAsync().then((v) => { voices.current = v; }).catch(() => {});
    repo.voiceSettings().then((s) => { settings.current = s; }).catch(() => {});
  }, [repo]));
  // Bluetooth headphones that have been quiet lose the start of the next sound (useOutputWake). A
  // request that a newer one, or a stop, replaced while the link woke says nothing.
  const wake = useOutputWake();
  const afterWake = async (say: () => void) => {
    const mine = ++latestSpeech;
    await wake();
    if (mine === latestSpeech) say();
  };
  return useMemo(() => ({
    /** An Omnilanguage card's word, in its note's language. */
    sayWord: (text: string, lang: string | undefined) => afterWake(() => speakUntilStarted(text, wordSpeech(voices.current, settings.current, lang))),
    /** A line of conversation (Situations), in its language: at the chosen speed, or that times `slow` (`SLOW_RATE`) for a slow one. */
    sayLine: async (text: string, lang: string, slow: boolean) => {
      await stopSpeechIfRunning();
      await afterWake(() => speakUntilStarted(text, lineSpeech(voices.current, settings.current, lang, slow ? SLOW_RATE : NORMAL_RATE)));
    },
    /** Drops a retry still waiting on an utterance the voice never started, for a sound that plays instead. */
    cancelPending: () => { latestSpeech++; },
    /** Stops whatever is being read. */
    stop: () => { latestSpeech++; Speech.stop().catch(() => {}); },
    /** Anki's {{tts}} tags, one after another. */
    readTags: async (tags: TtsTag[]) => {
      await stopSpeechIfRunning();
      await afterWake(() => { for (const t of tags) Speech.speak(t.text, speechTracking(tagSpeech(voices.current, settings.current, t))); });
    },
  }), []); // eslint-disable-line react-hooks/exhaustive-deps -- `wake` is stable and the rest are refs
}
