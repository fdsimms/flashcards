import { useFocusEffect } from 'expo-router';
import * as Speech from 'expo-speech';
import { useCallback, useMemo, useRef } from 'react';
import type { TtsTag } from '../core/tts';
import { lineSpeech, tagSpeech, wordSpeech, type PhoneVoice, type VoiceSettings } from '../core/voices';
import type { Repo } from '../db/repo';
import { NORMAL_RATE, SLOW_RATE } from '../reader/playbackRate';

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
    sayWord: (text: string, lang: string | undefined) => Speech.speak(text, wordSpeech(voices.current, settings.current, lang)),
    /** A line of conversation (Situations), in its language: at the chosen speed, or that times `slow` (`SLOW_RATE`) for a slow one. */
    sayLine: (text: string, lang: string, slow: boolean) => {
      Speech.stop().catch(() => {});
      Speech.speak(text, lineSpeech(voices.current, settings.current, lang, slow ? SLOW_RATE : NORMAL_RATE));
    },
    /** Stops whatever is being read. */
    stop: () => { Speech.stop().catch(() => {}); },
    /** Anki's {{tts}} tags, one after another. */
    readTags: (tags: TtsTag[]) => { for (const t of tags) Speech.speak(t.text, tagSpeech(voices.current, settings.current, t)); },
  }), []);
}
