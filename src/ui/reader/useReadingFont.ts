import { useEffect } from 'react';
import { languageChoice, withLanguageFont, type AppFont } from '../../core/fonts';
import type { GlossLanguage } from '../../reader/api';
import { legacyLanguageFont } from '../../reader/fonts';
import { prefs, savePrefs } from '../../reader/storage';
import { useFontSettings, useLanguageFont } from '../AppFont';

/**
 * The font Read & Listen draws a text of `language` in: the one chosen for that language (Text menu,
 * Settings, Font), else the app's. A Thai reader who had picked Loopless before fonts were chosen per
 * language keeps it: it's shown at once and saved as Thai's font (Prompt) the first time this runs.
 */
export function useReadingFont(language: GlossLanguage): AppFont {
  const { settings, save } = useFontSettings();
  const font = useLanguageFont(language);
  const chosen = languageChoice(settings, language);
  const legacy = chosen ? undefined : legacyLanguageFont(language, prefs().thaiFont);
  useEffect(() => {
    if (!legacy) return;
    save(withLanguageFont(settings, language, legacy)).then(() => savePrefs({ thaiFont: 'looped' }), () => undefined);
  }, [legacy, language, settings, save]);
  return legacy ?? font;
}
