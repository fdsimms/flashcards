import { useCallback, useEffect, useState } from 'react';
import type { Language } from '../reader/api';
import { loadToolPrefs, saveToolPrefs, toolPrefs } from '../tools/storage';
import { listLanguage } from '../tools/tools';

/** The language the Practice list is showing: the one every tool opens in (tools/prefs.ts), kept between launches. */
export function usePracticeLanguage(): [Language, (l: Language) => void] {
  const [language, setLanguage] = useState<Language>(() => listLanguage(toolPrefs().language));
  useEffect(() => {
    let live = true;
    loadToolPrefs().then((p) => { if (live) setLanguage(listLanguage(p.language)); });
    return () => { live = false; };
  }, []);
  const choose = useCallback((l: Language) => { setLanguage(l); saveToolPrefs({ language: l }); }, []);
  return [language, choose];
}
