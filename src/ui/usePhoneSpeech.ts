import { useFocusEffect } from 'expo-router';
import * as Speech from 'expo-speech';
import { useCallback, useMemo, useRef } from 'react';
import type { TtsTag } from '../core/tts';
import { lineSpeech, tagSpeech, wordSpeech, type PhoneVoice, type VoiceSettings } from '../core/voices';
import type { Repo } from '../db/repo';
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
  return useMemo(() => ({
    /** An Omnilanguage card's word, in its note's language. */
    sayWord: (text: string, lang: string | undefined) => Speech.speak(text, speechTracking(wordSpeech(voices.current, settings.current, lang))),
    /** A line of conversation (Situations), in its language: at the chosen speed, or that times `slow` (`SLOW_RATE`) for a slow one. */
    sayLine: async (text: string, lang: string, slow: boolean) => {
      await stopSpeechIfRunning();
      Speech.speak(text, speechTracking(lineSpeech(voices.current, settings.current, lang, slow ? SLOW_RATE : NORMAL_RATE)));
    },
    /** Stops whatever is being read. */
    stop: () => { Speech.stop().catch(() => {}); },
    /** Anki's {{tts}} tags, one after another. */
    readTags: async (tags: TtsTag[]) => { await stopSpeechIfRunning(); for (const t of tags) Speech.speak(t.text, speechTracking(tagSpeech(voices.current, settings.current, t))); },
  }), []);
}
