import { Stack } from 'expo-router';
import React, { useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import { ApiError, type Api, type Language, type Settings } from '../../reader/api';
import { LANGUAGES, flaggedName } from '../../reader/languages';
import { LESSON_LANGUAGES } from '../../reader/lessons';
import { FLAG_IMAGES } from '../flagImages';

/**
 * The Lessons tab's language menu, in the header like Read & Listen's shelf. Lessons follow Read &
 * Listen's language, so picking one changes that setting on the server and the app's copy of it.
 */
export function LessonLanguageMenu({ language, onPick }: { language: Language; onPick: (l: Language) => void }) {
  const name = LANGUAGES[language].name;
  return (
    <Stack.Toolbar placement="left">
      <Stack.Toolbar.Menu icon={FLAG_IMAGES[language]} iconRenderingMode="original" accessibilityLabel={`Language: ${name}. Change the language`}>
        {LESSON_LANGUAGES.map((l) => (
          <Stack.Toolbar.MenuAction key={l} isOn={l === language} onPress={() => onPick(l)}>{flaggedName(l)}</Stack.Toolbar.MenuAction>
        ))}
      </Stack.Toolbar.Menu>
    </Stack.Toolbar>
  );
}

/** Sends the picked language to the server, then reads the settings back. Picks are sent one after another so the server ends on the last. */
export function useLessonLanguage(api: Api | null, setSettings: (s: Settings) => void): (l: Language) => void {
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  return useCallback((language: Language) => {
    if (!api) return;
    const run = queue.current.then(async () => {
      try {
        await api.updateSettings({ language });
        setSettings(await api.settings());
      } catch (e) {
        Alert.alert("Couldn't switch the language", e instanceof ApiError ? e.message : 'Check your connection, then try again.');
      }
    });
    queue.current = run;
  }, [api, setSettings]);
}
