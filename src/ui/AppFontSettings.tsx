import React from 'react';
import { Alert, ScrollView } from 'react-native';
import { downloadBytes, isAvailable, sizeText } from '../core/fontDownloads';
import { APP_FONT_OPTIONS, FONT_GROUPS, fontOption, togglePoolFont, type AppFont, type FontSettings } from '../core/fonts';
import { failureText } from '../core/failure';
import { useFontSettings } from './AppFont';
import { FontRow } from './FontRows';
import { Group, Help, Screen, SectionTitle, SwitchRow } from './kit';
import { space, readable } from './theme';

/**
 * Settings, Font: the typeface the whole app and its cards are set in. With Random font on, the list
 * is a pool and the app opens in one of the checked fonts each time. Thai keeps its own setting (Thai
 * text size on the cards, Looped or Loopless in Read & Listen), and Japanese keeps the system font.
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
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.m }}>
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
          <React.Fragment key={g.id}>
            <SectionTitle>{g.title}</SectionTitle>
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
          </React.Fragment>
        ))}
        <Group>
          <SwitchRow
            first
            label="Use on cards"
            hint="Card fronts and backs use this font too. A deck set to change fonts each session uses its own."
            value={settings.onCards}
            onValueChange={(onCards) => change({ ...settings, onCards })}
          />
        </Group>
        <Help>
          Most fonts are in the app. The Japanese ones are large, so each downloads the first time you pick it and can be removed to free the space. Each font lists the scripts it covers. Text in a script a font doesn't cover shows in the system font. Thai also has its own setting for Looped or Loopless.
          {settings.random && font !== settings.font ? ` Right now the app is in ${APP_FONT_OPTIONS.find((o) => o.id === font)?.label}.` : ''}
        </Help>
      </ScrollView>
    </Screen>
  );
}
