import { useCallback, useEffect, useState } from 'react';
import type { Language } from '../reader/api';
import { loadToolPrefs, saveToolPrefs, toolPrefs } from '../tools/storage';
import { listLanguage } from '../tools/tools';

/**
 * The language the Practice list is showing: the one every tool opens in (tools/prefs.ts), kept
 * between launches. Before one is chosen, the language with the most cards in the decks (`studied`),
 * which is saved too, so the tools open in it as well.
 */
export function usePracticeLanguage(studied: Language[]): [Language, (l: Language) => void] {
  const [language, setLanguage] = useState<Language>(() => listLanguage(toolPrefs().language, studied));
  const first = studied[0];
  useEffect(() => {
    let live = true;
    loadToolPrefs().then((p) => {
      if (!live) return;
      setLanguage(listLanguage(p.language, studied));
      if (!p.language && first) saveToolPrefs({ language: listLanguage(undefined, studied) });
    });
    return () => { live = false; };
  }, [first]); // eslint-disable-line react-hooks/exhaustive-deps -- the decks' first language is what decides
  const choose = useCallback((l: Language) => { setLanguage(l); saveToolPrefs({ language: l }); }, []);
  return [language, choose];
}
