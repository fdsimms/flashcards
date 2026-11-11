import React, { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { ANSWER_BUTTON_CHOICES, type AnswerButtons } from '../core/answerButtons';
import type { Repo } from '../db/repo';
import { CheckRow, Group, Help, NavRow, Screen, SectionTitle, SwitchRow } from './kit';
import { space, useTheme } from './theme';

/**
 * App-wide settings: the screens that aren't about studying (Anki, Stats, Backup), and which
 * answer buttons Review shows.
 */
export function Settings({ repo, backupText, onAnki, onStats, onBackup }: {
  repo: Repo;
  /** When the last backup was made (`backupStatus`). */
  backupText?: string;
  onAnki: () => void;
  onStats: () => void;
  onBackup: () => void;
}) {
  const c = useTheme();
  const [buttons, setButtons] = useState<AnswerButtons>();
  const [swipe, setSwipe] = useState<boolean>();

  useEffect(() => { repo.answerButtons().then(setButtons); repo.swipeToRate().then(setSwipe); }, [repo]);

  const choose = async (value: AnswerButtons) => {
    setButtons(value);
    await repo.saveAnswerButtons(value);
  };

  const chooseSwipe = async (on: boolean) => {
    setSwipe(on);
    await repo.saveSwipeToRate(on);
  };

  return (
    <Screen title="Settings">
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.m }}>
        <Group>
          {/* The tile colors are the rating colors: each is picked so white reads on it in light and dark. */}
          <NavRow first icon={{ name: 'arrow.triangle.2.circlepath', color: c.easy }} label="Anki" detail="Sync, or send your collection to and from Anki by file" onPress={onAnki} />
          <NavRow icon={{ name: 'chart.bar.fill', color: c.good }} label="Stats" detail="Answers, how much you remember, and what's coming due" onPress={onStats} />
          <NavRow icon={{ name: 'externaldrive.fill', color: c.hard }} label="Backup" detail={backupText ?? 'Save or restore everything in Franki'} onPress={onBackup} />
        </Group>
        <SectionTitle>Review</SectionTitle>
        <Group>
          <SwitchRow
            first
            label="Swipe to answer"
            hint="After the answer is shown, drag the card right for Good or left for Again. Only for Omnilanguage cards; other note types use the buttons."
            value={!!swipe}
            onValueChange={chooseSwipe}
          />
        </Group>
        <SectionTitle>Answer buttons</SectionTitle>
        <Group accessibilityRole="radiogroup">
          {ANSWER_BUTTON_CHOICES.map((choice, i) => (
            <CheckRow
              key={choice.value}
              first={i === 0}
              label={choice.label}
              hint={choice.hint}
              selected={buttons === choice.value}
              onPress={() => choose(choice.value)}
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
