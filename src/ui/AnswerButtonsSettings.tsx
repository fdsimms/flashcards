import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, ScrollView } from 'react-native';
import { ANSWER_BUTTON_CHOICES, type AnswerButtons } from '../core/answerButtons';
import { failureText } from '../core/failure';
import type { Repo } from '../db/repo';
import { CheckRow, Group, Help, Screen } from './kit';
import { space } from './theme';

/** Settings, Answer buttons: which of Again, Hard, Good and Easy Review shows after the answer, for every deck. */
export function AnswerButtonsSettings({ repo }: { repo: Repo }) {
  const [buttons, setButtons] = useState<AnswerButtons>();
  useFocusEffect(useCallback(() => { repo.answerButtons().then(setButtons).catch(() => undefined); }, [repo]));

  // Saved first, then shown, so the screen never shows a setting that isn't stored.
  const choose = async (value: AnswerButtons) => {
    try {
      await repo.saveAnswerButtons(value);
      setButtons(value);
    } catch (e) {
      Alert.alert("Couldn't save this setting", failureText(e, { next: 'Try again.' }));
    }
  };

  return (
    <Screen title="Answer buttons">
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.m }}>
        <Group accessibilityRole="radiogroup">
          {ANSWER_BUTTON_CHOICES.map((choice, i) => (
            <CheckRow
              key={choice.value}
              first={i === 0}
              label={choice.label}
              hint={choice.hint}
              selected={buttons === choice.value}
              onPress={() => void choose(choice.value)}
            />
          ))}
        </Group>
        <Help>
          The buttons shown after the answer, for every deck. Whether you remembered a card matters most to the
          schedule. Hard and Easy only move the next review a little closer or further out.
        </Help>
        <Help>
          Always press Again for a card you didn't remember, even one you nearly had. If you change how you use the
          buttons, run Optimize in each deck's options in Anki after a few weeks, so its schedule learns your new habit.
        </Help>
      </ScrollView>
    </Screen>
  );
}
