import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { keyboardEnabled } from '../../modules/keyboard-language';
import { keyboardLanguageFor } from '../core/keyboardLanguage';
import { languageKey, languageName } from '../core/voices';
import { type, useTheme } from './theme';

/**
 * For a field that expects an answer in `speechTag`'s language, written in its own script (Thai,
 * Russian, Japanese...): the line that says how to add its keyboard, when the person hasn't. iOS
 * opens a field on a language's keyboard only once it's enabled (modules/keyboard-language), and a
 * learner new to a script almost never has it yet. Undefined for a Latin-script language, which the
 * English keyboard types, and whenever it can't be told.
 */
export function useMissingKeyboard(speechTag: string | undefined | null): string | undefined {
  const language = keyboardLanguageFor(speechTag);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let live = true;
    setMissing(false);
    if (language && language !== 'en') keyboardEnabled(language).then((on) => { if (live) setMissing(on === false); });
    return () => { live = false; };
  }, [language]);
  if (!missing || !speechTag) return undefined;
  const name = languageName(languageKey(speechTag));
  return `To type in ${name}, add the ${name} keyboard in the Settings app: General, Keyboard, Keyboards.`;
}

/** The line under an answer box that types `speechTag`'s language without `Field`: how to add its keyboard, when it's missing. */
export function MissingKeyboardNote({ speechTag }: { speechTag: string | undefined | null }) {
  const c = useTheme();
  const note = useMissingKeyboard(speechTag);
  return note ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{note}</Text> : null;
}
