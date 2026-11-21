import { Host, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, useColorScheme, View } from 'react-native';
import { ApiError, type Api, type DailyTaskMode, type Language, type Settings, type SettingsChange } from '../../reader/api';
import { clampRotateCount, DAILY_MODES, dailyModeOf, ROTATE_COUNT_RANGE } from '../../reader/dailyTasks';
import { flaggedName, LANGUAGE_ORDER } from '../../reader/languages';
import { haptic } from '../haptics';
import { Divider, ErrorNote, Group, Help, Icon, Screen, SectionTitle, Tappable } from '../kit';
import { MIN_TAP, readable, space, type, useTheme } from '../theme';

/**
 * The daily reading tasks: which languages dundundun adds a Read & Listen task for each day. Each
 * language is Every day, Rotate or Off, and a number of the rotating ones get a task a day. The
 * server picks them (docs/read-and-listen/architecture.md, Status); this only sets the rules.
 */
export function ReadDailyTasks({ api, onSettings }: {
  api: Api;
  /** The settings as the server has them, each time they load or change. */
  onSettings: (settings: Settings) => void;
}) {
  const c = useTheme();
  const dark = useColorScheme() === 'dark';
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await api.settings();
      setSettings(s);
      onSettings(s);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load these settings.");
    }
  }, [api]); // eslint-disable-line react-hooks/exhaustive-deps -- onSettings is the app's setter
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Each change is numbered, so only the latest one's answer (or failure) is shown.
  const seq = useRef(0);
  const change = async (update: SettingsChange) => {
    if (!settings) return;
    const before = settings;
    const mine = ++seq.current;
    setSettings({
      ...settings,
      daily_tasks: { ...settings.daily_tasks, ...update.daily_tasks },
      daily_rotate_count: update.daily_rotate_count ?? settings.daily_rotate_count,
    });
    setFailed(null);
    try {
      const saved = await api.updateSettings(update);
      if (mine !== seq.current) return;
      setSettings(saved);
      onSettings(saved);
    } catch (e) {
      if (mine !== seq.current) return;
      setSettings(before);
      setFailed(e instanceof ApiError ? e.message : "Couldn't change that setting. Try again.");
    }
  };

  // A server from before the setting doesn't send it, and has nothing to change.
  const supported = settings?.daily_tasks !== undefined;
  const count = settings?.daily_rotate_count ?? 1;
  const setCount = (next: number) => {
    const clamped = clampRotateCount(next);
    if (clamped === count) return;
    haptic.select();
    change({ daily_rotate_count: clamped });
  };

  return (
    <Screen title="Daily reading tasks">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }}
      >
        {error ? <ErrorNote message={error} onRetry={load} /> : null}
        {!settings && !error ? <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} /> : null}
        {settings && !supported ? (
          <Help>Your Read & Listen server hasn't been updated for this yet. It updates itself within about 15 minutes of a new version, so open this again then.</Help>
        ) : null}

        {settings && supported ? (
          <>
            <SectionTitle>Each language</SectionTitle>
            <Group>
              {LANGUAGE_ORDER.map((language: Language, i) => (
                <View
                  key={language}
                  style={{ minHeight: MIN_TAP + space.m, flexDirection: 'row', alignItems: 'center', gap: space.m, paddingHorizontal: space.l }}
                >
                  {i === 0 ? null : <Divider inset={space.l} />}
                  <Text style={{ ...type.body, color: c.text, flex: 1 }}>{flaggedName(language)}</Text>
                  <Host matchContents colorScheme={dark ? 'dark' : 'light'} seedColor={c.accent}>
                    <Picker
                      label={flaggedName(language)}
                      modifiers={[pickerStyle('menu')]}
                      selection={dailyModeOf(settings, language)}
                      onSelectionChange={(mode: DailyTaskMode) => { haptic.select(); change({ daily_tasks: { [language]: mode } }); }}
                    >
                      {DAILY_MODES.map((m) => (
                        <SwiftText key={m.value} modifiers={[tag(m.value)]}>{m.label}</SwiftText>
                      ))}
                    </Picker>
                  </Host>
                </View>
              ))}
            </Group>
            <Help>
              Languages set to Every day get a task on each day a text is waiting. Languages set to Rotate take turns,
              starting with the one you read least recently. Reading one yourself counts as its turn.
            </Help>

            <SectionTitle>Rotation</SectionTitle>
            <Group>
              <View style={{ minHeight: MIN_TAP + space.m, flexDirection: 'row', alignItems: 'center', gap: space.m, paddingHorizontal: space.l }}>
                <Text style={{ ...type.body, color: c.text, flex: 1 }}>Rotating languages a day</Text>
                <Tappable
                  onPress={() => setCount(count - 1)}
                  disabled={count <= ROTATE_COUNT_RANGE.min}
                  accessibilityRole="button"
                  accessibilityLabel="One fewer rotating language a day"
                  style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center', opacity: count <= ROTATE_COUNT_RANGE.min ? 0.4 : 1 }}
                >
                  <Icon name="minus" size={16} color={c.text} weight="semibold" />
                </Tappable>
                <Text accessibilityLabel={`${count} rotating ${count === 1 ? 'language' : 'languages'} a day`} style={{ ...type.body, color: c.text, minWidth: 20, textAlign: 'center' }}>{count}</Text>
                <Tappable
                  onPress={() => setCount(count + 1)}
                  disabled={count >= ROTATE_COUNT_RANGE.max}
                  accessibilityRole="button"
                  accessibilityLabel="One more rotating language a day"
                  style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center', opacity: count >= ROTATE_COUNT_RANGE.max ? 0.4 : 1 }}
                >
                  <Icon name="plus" size={16} color={c.text} weight="semibold" />
                </Tappable>
              </View>
            </Group>
            <Help>Each day, dundundun adds a Read & Listen task for each language chosen that day.</Help>
            {failed ? <ErrorNote message={failed} /> : null}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
