import { Stack, useRouter } from 'expo-router';
import React from 'react';
import { Alert } from 'react-native';
import { failureText } from '../core/failure';
import { fontOption, languageCode, languageChoice, withLanguageFont, type AppFont } from '../core/fonts';
import { languageFontChoices } from '../core/fontDownloads';
import type { Language } from '../reader/api';
import { TEXT_SIZES, TEXT_SIZE_LABELS, type TextSize } from '../reader/fonts';
import { LANGUAGES } from '../reader/languages';
import { useFontSettings, useLanguageFont } from './AppFont';

/**
 * The Text menu: the font target-language text is drawn in, and optionally its size. Every screen that
 * shows text in the language being learned has it (Read & Listen, Review, Cram, Practice), and they all
 * read and write the same setting, `FontSettings.languages`, so choosing Russian's font in one is what
 * the others show. Settings, Font has the same choice.
 */

export interface TextFont {
  /** The two-letter code the choice is saved under, undefined when the screen doesn't know the language. */
  code: string | undefined;
  /** The language's name for the menu's heading. */
  name: string;
  /** The font in use for this language now: the one chosen, else the app's. */
  font: AppFont;
  /** The fonts the menu offers: those that draw the language and are on the phone. */
  choices: AppFont[];
  choose: (id: AppFont) => void;
  /** Opens Settings, Font, which lists every font and the downloads. */
  more: () => void;
}

export function useTextFont(language: string | null | undefined): TextFont {
  const { settings, installed, save } = useFontSettings();
  const router = useRouter();
  const font = useLanguageFont(language);
  const code = languageCode(language);
  return {
    code,
    name: (code && LANGUAGES[code as Language]?.name) || 'Text',
    font,
    choices: languageFontChoices(language, installed),
    choose: (id) => {
      if (!code || languageChoice(settings, code) === id) return;
      // Saved first, then shown (AppFontScope.save), so the menu never shows a font that isn't stored.
      save(withLanguageFont(settings, code, id)).catch((e) => Alert.alert("Couldn't save this setting", failureText(e, { next: 'Try again.' })));
    },
    more: () => router.push('/app-font'),
  };
}

/**
 * The Text menu's rows, for inside a `Stack.Toolbar.Menu`. A plain function called there, since the
 * toolbar drops any other child (`tests/noCustomToolbarChildren.test.ts`). With no language known there
 * are no font rows, only the size.
 */
export function textRows(t: TextFont, size?: { value: TextSize; onChange: (s: TextSize) => void }): React.ReactElement[] {
  // An array, not a fragment: the menu keeps only its own Menu and MenuAction children and drops a fragment.
  const rows: React.ReactElement[] = [];
  if (t.code) {
    rows.push(
      <Stack.Toolbar.Menu key="font" inline title={`${t.name} font`}>
        {t.choices.map((id) => (
          <Stack.Toolbar.MenuAction key={id} isOn={t.font === id} onPress={() => t.choose(id)}>{fontOption(id).label}</Stack.Toolbar.MenuAction>
        ))}
        <Stack.Toolbar.MenuAction icon="ellipsis" onPress={t.more}>More fonts…</Stack.Toolbar.MenuAction>
      </Stack.Toolbar.Menu>,
    );
  }
  if (size) {
    rows.push(
      <Stack.Toolbar.Menu key="size" inline title="Text size">
        {TEXT_SIZES.map((s) => (
          <Stack.Toolbar.MenuAction key={s} isOn={size.value === s} onPress={() => size.onChange(s)}>{TEXT_SIZE_LABELS[s]}</Stack.Toolbar.MenuAction>
        ))}
      </Stack.Toolbar.Menu>,
    );
  }
  return rows;
}

/** The Text menu as a header button of its own (Cram, the Practice tools). */
export function textMenu(t: TextFont, size?: { value: TextSize; onChange: (s: TextSize) => void }) {
  return (
    <Stack.Toolbar.Menu icon="textformat.size" title="Text" accessibilityLabel="Text: font and size">
      {textRows(t, size)}
    </Stack.Toolbar.Menu>
  );
}
