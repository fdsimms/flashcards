import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, ScrollView } from 'react-native';
import { ANSWER_BUTTON_CHOICES, type AnswerButtons } from '../core/answerButtons';
import { failureText } from '../core/failure';
import type { Repo } from '../db/repo';
import { CheckRow, Group, Help, Screen, Section, SECTION_GAP } from './kit';
import { space, readable } from './theme';

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
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl, gap: SECTION_GAP }}>
        <Section
          footer={(
            <>
              <Help>
                Applies to every deck. The schedule mostly cares whether you pressed Again. On a card you've studied before,
                Hard and Easy move the next review a little closer or further out. On a new card, Easy skips the steps that bring
                it back the same day, and the next review is days away.
              </Help>
              <Help>
                Always press Again for a card you didn't remember, even one you nearly had. If you change how you use the
                buttons, run Optimize in each deck's options in Anki once you've used them the new way for a few weeks.
              </Help>
            </>
          )}
        >
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
        </Section>
      </ScrollView>
    </Screen>
  );
}
