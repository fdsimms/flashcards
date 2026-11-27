import React from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { downloadBytes, isAvailable, languageFontChoices, sizeText } from '../core/fontDownloads';
import { APP_FONT_OPTIONS, FONT_GROUPS, fontOption, languageChoice, togglePoolFont, withLanguageFont, type AppFont, type FontSettings } from '../core/fonts';
import { LANGUAGE_ORDER, LANGUAGES } from '../reader/languages';
import { failureText } from '../core/failure';
import { useFontSettings } from './AppFont';
import { FontRow } from './FontRows';
import { Group, Help, Screen, Section, SECTION_GAP, Select, SwitchRow } from './kit';
import { space, readable } from './theme';

/** What a language set to follow the app's font is called in its picker. */
const APP_FONT_LABEL = 'App font';

/**
 * Settings, Font: the typeface the whole app and its cards are set in. With Random font on, the list
 * is a pool and the app opens in one of the checked fonts each time. By language, a language can have a
 * font of its own (the Text menu on the screens that show it sets the same one); Thai's Looped and
 * Loopless are System and Prompt there. Thai text size on the cards is its own setting.
 */
export function AppFontSettings() {
  const { settings, font, save, installed, progress, download, remove } = useFontSettings();

  // Saved first, then shown (AppFontScope.save), so the screen never shows a setting that isn't stored.
  const change = async (next: FontSettings) => {
    try {
      await save(next);
    } catch (e) {
      Alert.alert("Couldn't save this setting", failureText(e, { next: 'Try again.' }));
    }
  };
  // A font that isn't on the phone is downloaded first; it isn't picked until it's there.
  const get = async (id: AppFont) => {
    if (progress.has(id)) return;
    try {
      await download(id);
    } catch (e) {
      Alert.alert(`Couldn't download ${fontOption(id).label}`, failureText(e, { next: 'Try again.' }));
    }
  };
  const confirmRemove = (id: AppFont) => {
    const label = fontOption(id).label;
    const inUse = font === id || settings.font === id || settings.pool.includes(id);
    Alert.alert(`Remove ${label}?`, `This frees ${sizeText(downloadBytes(id))}.${inUse ? ' The app and any deck set to use it show in the system font until you download it again.' : ' You can download it again here.'}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => remove(id) },
    ]);
  };
  const setRandom = (random: boolean) => change({ ...settings, random, pool: random && !settings.pool.includes(settings.font) ? [settings.font, ...settings.pool] : settings.pool });

  return (
    <Screen title="Font">
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl, gap: SECTION_GAP }}>
        <Group>
          <SwitchRow
            first
            label="Random font"
            hint={settings.random ? 'Opens the app in one of the checked fonts each time.' : 'Pick one font, or turn this on to choose several.'}
            value={settings.random}
            onValueChange={setRandom}
          />
        </Group>
        {FONT_GROUPS.map((g) => (
          <Section key={g.id} title={g.title}>
            <Group accessibilityRole={settings.random ? 'list' : 'radiogroup'}>
              {APP_FONT_OPTIONS.filter((o) => o.group === g.id).map((o, i) => (
                <FontRow
                  key={o.id}
                  id={o.id}
                  first={i === 0}
                  detail
                  choice={settings.random ? 'many' : 'one'}
                  selected={isAvailable(o.id, installed) && (settings.random ? settings.pool.includes(o.id) : settings.font === o.id)}
                  download={isAvailable(o.id, installed) ? undefined : { size: sizeText(downloadBytes(o.id)), progress: progress.get(o.id) }}
                  onRemove={o.download && installed.has(o.id) ? () => confirmRemove(o.id) : undefined}
                  onPress={() => (!isAvailable(o.id, installed) ? get(o.id) : settings.random ? change({ ...settings, pool: togglePoolFont(settings.pool, o.id) }) : change({ ...settings, font: o.id, pool: [o.id] }))}
                />
              ))}
            </Group>
          </Section>
        ))}
        <Section
          footer={(
            <Help>
              The Japanese fonts are large, so each downloads the first time you pick it and can be removed to free the space. Text in a script a font doesn't cover shows in the system font.
              {settings.random && font !== settings.font ? ` Right now the app is in ${APP_FONT_OPTIONS.find((o) => o.id === font)?.label}.` : ''}
            </Help>
          )}
        >
          <Group>
            <SwitchRow
              first
              label="Use on cards"
              hint="Card fronts and backs use this font too. A deck with its own card font uses that instead."
              value={settings.onCards}
              onValueChange={(onCards) => change({ ...settings, onCards })}
            />
          </Group>
        </Section>
        <Section
          title="By language"
          footer={(
            <Help>
              A font for the text of one language, wherever it's shown: cards, Read & Listen, Cram, Lessons and Practice. The Text menu on those screens sets the same choice. A deck with its own card font keeps it. Only fonts that can draw the language and are downloaded are listed.
            </Help>
          )}
        >
          <View style={{ gap: space.m }}>
            {LANGUAGE_ORDER.map((code) => {
              const chosen = languageChoice(settings, code);
              return (
                <Select
                  key={code}
                  label={LANGUAGES[code].name}
                  options={[APP_FONT_LABEL, ...languageFontChoices(code, installed).map((id) => fontOption(id).label)]}
                  value={chosen ? fontOption(chosen).label : APP_FONT_LABEL}
                  onChange={(label) => change(withLanguageFont(settings, code, APP_FONT_OPTIONS.find((o) => o.label === label)?.id))}
                />
              );
            })}
          </View>
        </Section>
      </ScrollView>
    </Screen>
  );
}
