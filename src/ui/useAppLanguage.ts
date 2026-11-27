import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { ApiError, type Language } from '../reader/api';
import { spokenLanguage } from '../reader/languages';
import { loadToolPrefs, onToolLanguage, saveToolPrefs, toolPrefs } from '../tools/storage';
import type { ReaderState } from './useReader';

/**
 * The one language the app is working in. Practice, Lessons and Read & Listen all show it, so
 * picking Thai in one leaves none of the others on Greek. It is kept on the phone with the tools'
 * settings (`toolPrefs().language`), which works with Read & Listen off, and Read & Listen's own
 * server setting is made to match it.
 */
export function useAppLanguage(): [Language | undefined, (l: Language) => void] {
  const [language, setLanguage] = useState<Language | undefined>(() => toolPrefs().language);
  useEffect(() => {
    let live = true;
    loadToolPrefs().then((p) => { if (live) setLanguage(p.language); });
    const stop = onToolLanguage(setLanguage);
    return () => { live = false; stop(); };
  }, []);
  const choose = useCallback((l: Language) => saveToolPrefs({ language: l }), []);
  return [language, choose];
}

/**
 * Keeps Read & Listen's language and the phone's one language the same, called once from AppContext.
 * A pick anywhere is sent to the server (one after another, so it ends on the last); a change made
 * on the server's side (the shelf, a link, another device) becomes the phone's. A pick the server
 * refuses is taken back, so the screens don't show a language the shelf isn't in.
 */
export function useAppLanguageSync({ api, settings, setSettings }: Pick<ReaderState, 'api' | 'settings' | 'setSettings'>): void {
  const serverLanguage = settings?.language;
  const inFlight = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const serverRef = useRef(serverLanguage);
  serverRef.current = serverLanguage;

  // The server's language is the phone's, except while a pick of ours is on its way: a settings
  // read from before it would otherwise put the old language back. Toki Pona, which Practice and
  // Lessons don't cover, is Read & Listen's alone: the phone keeps the language it had.
  useEffect(() => {
    const spoken = spokenLanguage(serverLanguage);
    if (spoken && inFlight.current === 0 && spoken !== toolPrefs().language) saveToolPrefs({ language: spoken });
  }, [serverLanguage]);

  useEffect(() => {
    if (!api) return undefined;
    return onToolLanguage((language) => {
      if (!language || language === serverRef.current) return;
      inFlight.current++;
      queue.current = queue.current.then(async () => {
        try {
          await api.updateSettings({ language });
          setSettings(await api.settings());
        } catch (e) {
          // Only the last pick is taken back: an earlier one the server refused is already replaced.
          const back = spokenLanguage(serverRef.current);
          if (inFlight.current === 1 && back) saveToolPrefs({ language: back });
          Alert.alert("Couldn't switch the language", e instanceof ApiError ? e.message : 'Check your connection, then try again.');
        } finally {
          inFlight.current--;
        }
      });
    });
  }, [api, setSettings]);
}
