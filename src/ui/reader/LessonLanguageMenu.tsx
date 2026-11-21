import { Stack } from 'expo-router';
import React from 'react';
import type { Language } from '../../reader/api';
import { LANGUAGES, flaggedName } from '../../reader/languages';
import { LESSON_LANGUAGES } from '../../reader/lessons';
import { FLAG_IMAGES } from '../flagImages';

/**
 * The Lessons tab's language menu, in the header like Read & Listen's shelf. Lessons are in the app's one
 * language (useAppLanguage), so picking one changes it for Practice and Read & Listen too.
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
