import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { failureText } from '../core/failure';
import { recognitionLocale } from '../core/speaking';
import type { Repo } from '../db/repo';
import { LANGUAGE_ORDER, LANGUAGES } from '../reader/languages';
import { Group, Help, Screen, SectionTitle, SwitchRow } from './kit';
import { hairline, MIN_TAP, space, type, useTheme } from './theme';
import { supportedLocales } from './useSpokenAnswer';

/**
 * Settings, Speaking: Answer by speaking (src/core/speaking.ts), off until turned on, and which of
 * the app's languages this iPhone can hear. Whether a language is heard on the phone or by Apple's
 * servers isn't something iOS says, so the list doesn't either.
 */
export function SpeakingSettings({ repo }: { repo: Repo }) {
  const c = useTheme();
  const [on, setOn] = useState<boolean>();
  const [locales, setLocales] = useState<string[] | null>(null);
  useEffect(() => { repo.answerBySpeaking().then(setOn).catch(() => setOn(false)); }, [repo]);
  useEffect(() => { supportedLocales().then(setLocales).catch(() => setLocales([])); }, []);

  const choose = async (value: boolean) => {
    try {
      await repo.saveAnswerBySpeaking(value);
      setOn(value);
    } catch (e) {
      Alert.alert("Couldn't save this setting", failureText(e, { next: 'Try again.' }));
    }
  };

  return (
    <Screen title="Speaking">
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.m }}>
        <Group>
          <SwitchRow
            first
            label="Answer by speaking"
            hint="A microphone beside Type it, Say it back, Sentences and Situations. What you say is turned into text and compared, like typing."
            value={!!on}
            onValueChange={(v) => void choose(v)}
          />
        </Group>
        <Help>
          Off until you turn it on. What you say is turned into text on the iPhone where iOS can for the language,
          otherwise by Apple's servers. Your answer is still yours to rate.
        </Help>
        <SectionTitle>On this iPhone</SectionTitle>
        <Group>
          {LANGUAGE_ORDER.filter((l) => l !== 'en').map((l, i) => {
            const heard = locales ? !!recognitionLocale(LANGUAGES[l].speech, locales) : null;
            return (
              <View
                key={l}
                accessible
                style={{ flexDirection: 'row', alignItems: 'center', minHeight: MIN_TAP + space.s, paddingHorizontal: space.l, borderTopWidth: i ? hairline : 0, borderTopColor: c.border }}
              >
                <Text style={{ ...type.body, color: c.text, flex: 1 }}>{LANGUAGES[l].name}</Text>
                <Text style={{ ...type.subhead, color: heard ? c.countDue : c.textSecondary }}>
                  {heard === null ? '' : heard ? 'Can be heard' : "Can't be heard"}
                </Text>
              </View>
            );
          })}
        </Group>
        <Help>
          {"A language that can't be heard has no microphone; type it instead. Adding it in the iPhone's Settings, General, Keyboard, Dictation may keep it on the phone."}
        </Help>
      </ScrollView>
    </Screen>
  );
}
