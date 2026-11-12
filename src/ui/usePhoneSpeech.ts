import * as Speech from 'expo-speech';
import { useEffect, useMemo, useRef } from 'react';
import type { TtsTag } from '../core/tts';
import { tagSpeech, wordSpeech, type PhoneVoice, type VoiceSettings } from '../core/voices';
import type { Repo } from '../db/repo';

/**
 * Reading aloud with the phone's voices, in the voice and at the speed chosen for each language
 * (Settings, Voices). The phone's voices and the choices are loaded once, when the screen opens.
 */
export function usePhoneSpeech(repo: Repo) {
  const voices = useRef<PhoneVoice[]>([]);
  const settings = useRef<VoiceSettings>({});
  useEffect(() => {
    Speech.getAvailableVoicesAsync().then((v) => { voices.current = v; }).catch(() => {});
    repo.voiceSettings().then((s) => { settings.current = s; }).catch(() => {});
  }, [repo]);
  return useMemo(() => ({
    /** An Omnilanguage card's word, in its note's language. */
    sayWord: (text: string, lang: string | undefined) => Speech.speak(text, wordSpeech(voices.current, settings.current, lang)),
    /** Anki's {{tts}} tags, one after another. */
    readTags: (tags: TtsTag[]) => { for (const t of tags) Speech.speak(t.text, tagSpeech(voices.current, settings.current, t)); },
  }), []);
}
