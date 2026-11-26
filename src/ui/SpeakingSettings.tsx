import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { failureText } from '../core/failure';
import { supportsOnDevice } from '../../modules/speech-on-device';
import { hearingText, recognitionLocale } from '../core/speaking';
import type { Repo } from '../db/repo';
import { LANGUAGE_ORDER, LANGUAGES } from '../reader/languages';
import { Group, Help, Screen, Section, SECTION_GAP, SwitchRow } from './kit';
import { hairline, MIN_TAP, space, type, useTheme, readable } from './theme';
import { supportedLocales } from './useSpokenAnswer';
import { pitchEveryLanguage } from './pitchPrefs';

/**
 * Settings, Speaking: Answer by speaking (src/core/speaking.ts), off until turned on, Record yourself's
 * pitch line in every language (pitchPrefs.ts), and which of
 * the app's languages this iPhone can hear. Whether a language is heard on the phone or by Apple's
 * servers isn't something iOS says, so the list doesn't either.
 */
export function SpeakingSettings({ repo }: { repo: Repo }) {
  const c = useTheme();
  const [on, setOn] = useState<boolean>();
  const [locales, setLocales] = useState<string[] | null>(null);
  const pitchEvery = pitchEveryLanguage.use();
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
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl, gap: SECTION_GAP }}>
        <Section
          footer={(
            <Help>
              Speech is turned into text on this iPhone when iOS supports the language, and by Apple's servers otherwise.
              You still rate each card yourself.
            </Help>
          )}
        >
          <Group>
            <SwitchRow
              first
              label="Answer by speaking"
              hint="A microphone beside Type it, Say it back, Sentences and Situations. What you say is turned into text and compared, like typing."
              value={!!on}
              onValueChange={(v) => void choose(v)}
            />
          </Group>
        </Section>
        <Section
          title="Record yourself"
          footer={<Help>The pitch line shows in Thai, Japanese and Norwegian, where a word's pitch tells it from another. It's worked out on this iPhone, and your recording never leaves it.</Help>}
        >
          <Group>
            <SwitchRow
              first
              label="Pitch line in every language"
              hint="After you record a card's word, draw your pitch over the recording's in every language, not only those."
              value={pitchEvery}
              onValueChange={pitchEveryLanguage.save}
            />
          </Group>
        </Section>
        <Section
          title="On this iPhone"
          footer={(
            <Help>
              {"Languages iOS can't recognize have no microphone. Ones that need Apple's servers have none while you're offline. Adding the language in the iPhone's Settings, General, Keyboard, Dictation may let this iPhone recognize it offline."}
            </Help>
          )}
        >
          <Group>
            {LANGUAGE_ORDER.filter((l) => l !== 'en').map((l, i) => {
              const locale = locales ? recognitionLocale(LANGUAGES[l].speech, locales) : undefined;
              const heard = locales ? !!locale : null;
              return (
                <View
                  key={l}
                  accessible
                  style={{ flexDirection: 'row', alignItems: 'center', minHeight: MIN_TAP + space.s, paddingHorizontal: space.l, borderTopWidth: i ? hairline : 0, borderTopColor: c.border }}
                >
                  <Text style={{ ...type.body, color: c.text, flex: 1 }}>{LANGUAGES[l].name}</Text>
                  <Text style={{ ...type.subhead, color: heard ? c.countDue : c.textSecondary }}>
                    {hearingText(heard, locale ? supportsOnDevice(locale) : null)}
                  </Text>
                </View>
              );
            })}
          </Group>
        </Section>
      </ScrollView>
    </Screen>
  );
}
