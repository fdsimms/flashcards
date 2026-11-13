import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { languageKey } from '../core/voices';

/**
 * Opens a language's voice and speed (Settings, Voices) over the screen, from a play button.
 * `speech` is the language the text is read in (th-TH, es-MX), the same code the voices are keyed by.
 */
export function useVoiceLink(): (speech: string) => void {
  const router = useRouter();
  return useCallback((speech: string) => {
    router.push({ pathname: '/voice-language', params: { lang: languageKey(speech) } });
  }, [router]);
}
