import { useCallback, useEffect } from 'react';
import { setKeyboardLanguage } from '../../modules/keyboard-language';
import { keyboardRequest } from '../core/keyboardLanguage';

/**
 * Props for a TextInput that expects `speechTag`'s language (ru-RU): while it has focus, iOS opens
 * the keyboard for that language if the person has enabled one (modules/keyboard-language). Spread
 * them on the field, or pass `keyboardLanguage` to `Field`. A language written in the Latin alphabet
 * asks for its own keyboard, then English (`keyboardRequest`).
 */
export function useKeyboardLanguage(speechTag: string | undefined | null) {
  const language = keyboardRequest(speechTag);
  const onFocus = useCallback(() => { if (language) setKeyboardLanguage(language); }, [language]);
  const onBlur = useCallback(() => { if (language) setKeyboardLanguage(null); }, [language]);
  // A field unmounted while focused (a sheet closing) doesn't blur.
  useEffect(() => () => { if (language) setKeyboardLanguage(null); }, [language]);
  return { onFocus, onBlur };
}
