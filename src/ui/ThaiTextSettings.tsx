import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, Text } from 'react-native';
import { failureText } from '../core/failure';
import { THAI_TEXT_CHOICES, thaiTextStyle, type ThaiTextSize } from '../core/script';
import type { Repo } from '../db/repo';
import { CheckRow, Group, Help, Screen, Section, SECTION_GAP } from './kit';
import { space, useTheme, readable } from './theme';

/** Settings, Thai text size: how large Thai is on a card, with a line of it at the chosen size. */
export function ThaiTextSettings({ repo }: { repo: Repo }) {
  const c = useTheme();
  const [size, setSize] = useState<ThaiTextSize>();
  useFocusEffect(useCallback(() => { repo.thaiTextSize().then(setSize).catch(() => undefined); }, [repo]));

  // Saved first, then shown, so the screen never shows a setting that isn't stored.
  const choose = async (value: ThaiTextSize) => {
    try {
      await repo.saveThaiTextSize(value);
      setSize(value);
    } catch (e) {
      Alert.alert("Couldn't save this setting", failureText(e, { next: 'Try again.' }));
    }
  };

  return (
    <Screen title="Thai text size">
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl, gap: SECTION_GAP }}>
        <Section
          footer={(
            <Help>
              Size of Thai example sentences and other Thai text on a card. The word on the front and back keeps its
              own size.
            </Help>
          )}
        >
          <Group accessibilityRole="radiogroup">
            {THAI_TEXT_CHOICES.map((choice, i) => (
              <CheckRow key={choice.value} first={i === 0} label={choice.label} selected={size === choice.value} onPress={() => void choose(choice.value)} />
            ))}
          </Group>
          <Text accessibilityLanguage="th-TH" style={{ ...thaiTextStyle(size ?? 'large'), color: c.text, paddingHorizontal: space.l }}>วันแรกผมหลงทาง</Text>
        </Section>
      </ScrollView>
    </Screen>
  );
}
