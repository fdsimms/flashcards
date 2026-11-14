import { useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView } from 'react-native';
import { ANSWER_BUTTON_CHOICES, type AnswerButtons } from '../core/answerButtons';
import { failureText } from '../core/failure';
import { THAI_TEXT_CHOICES, type ThaiTextSize } from '../core/script';
import type { Repo } from '../db/repo';
import { Group, Help, NavRow, Screen, SectionTitle, SwitchRow } from './kit';
import { reminderTime, useReminderPrefs } from './studyReminder';
import { useStudyToday, useVacationPrefs } from './vacationPrefs';
import { vacationDetail } from './vacationNotice';
import { space, useTheme } from './theme';

/**
 * App-wide settings: the screens that aren't about studying (Anki, Backup, Read & Listen, WaniKani), then
 * how studying goes (answer buttons, speaking, voices, the reminder, vacation mode) and how Omnilanguage
 * cards look and answer. A choice with an explanation of its own (answer buttons, Thai text size) opens a
 * short screen, so this one stays a list.
 */
export function Settings({ repo, backupText, readerOn, wanikaniOn, onAnki, onBackup, onRead, onWaniKani, onVoices, onReminder, onSpeaking, onVacation, onAnswerButtons, onThaiSize }: {
  repo: Repo;
  /** When the last backup was made (`backupStatus`). */
  backupText?: string;
  /** Whether Read & Listen is turned on. */
  readerOn: boolean;
  onRead: () => void;
  /** Whether WaniKani has a token. */
  wanikaniOn: boolean;
  onWaniKani: () => void;
  onAnki: () => void;
  onBackup: () => void;
  onVoices: () => void;
  onReminder: () => void;
  onVacation: () => void;
  onSpeaking: () => void;
  onAnswerButtons: () => void;
  onThaiSize: () => void;
}) {
  const c = useTheme();
  const [buttons, setButtons] = useState<AnswerButtons>();
  const [swipe, setSwipe] = useState<boolean>();
  const [hints, setHints] = useState<boolean>();
  const [hook, setHook] = useState<boolean>();
  const [speaking, setSpeaking] = useState<boolean>();
  const [thaiSize, setThaiSize] = useState<ThaiTextSize>();
  const reminder = useReminderPrefs();
  const vacation = useVacationPrefs();
  const { today } = useStudyToday();
  // Read each time Settings shows: they're changed on screens over this one.
  useFocusEffect(useCallback(() => {
    repo.answerBySpeaking().then(setSpeaking).catch(() => undefined);
    repo.answerButtons().then(setButtons).catch(() => undefined);
    repo.thaiTextSize().then(setThaiSize).catch(() => undefined);
  }, [repo]));

  useEffect(() => { repo.swipeToRate().then(setSwipe); repo.showCardHints().then(setHints); repo.askOwnHook().then(setHook); }, [repo]);

  // Saved first, then shown, so the screen never shows a setting that isn't stored.
  const save = async (write: () => Promise<void>, show: () => void) => {
    try {
      await write();
      show();
    } catch (e) {
      Alert.alert("Couldn't save this setting", failureText(e, { next: 'Try again.' }));
    }
  };
  const chooseSwipe = (on: boolean) => save(() => repo.saveSwipeToRate(on), () => setSwipe(on));
  const chooseHints = (on: boolean) => save(() => repo.saveShowCardHints(on), () => setHints(on));
  const chooseHook = (on: boolean) => save(() => repo.saveAskOwnHook(on), () => setHook(on));

  return (
    <Screen title="Settings">
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.m }}>
        <Group>
          {/* Tile colors are picked so white reads on them in light and dark, and none is a rating color, which would read as a warning. */}
          <NavRow first icon={{ name: 'arrow.triangle.2.circlepath', color: c.easy }} label="Anki" detail="Sync, or send your collection to and from Anki by file" onPress={onAnki} />
          <NavRow icon={{ name: 'externaldrive.fill', color: c.teal }} label="Backup" detail={backupText ?? 'Save or restore everything in Franki'} onPress={onBackup} />
          <NavRow icon={{ name: 'book.fill', color: c.indigo }} label="Read & Listen" detail={readerOn ? 'On' : 'Off. Texts to read and listen to, written from your decks'} onPress={onRead} />
          <NavRow icon={{ name: 'character.ja', color: c.violet }} label="WaniKani" detail={wanikaniOn ? 'On' : 'Off. Study your WaniKani reviews and lessons as a deck'} onPress={onWaniKani} />
        </Group>
        <SectionTitle>Studying</SectionTitle>
        <Group>
          <NavRow first label="Answer buttons" detail={ANSWER_BUTTON_CHOICES.find((x) => x.value === buttons)?.label} onPress={onAnswerButtons} />
          <NavRow label="Speaking" detail={speaking === undefined ? undefined : speaking ? 'On. Answer by speaking' : 'Off. Answer by speaking instead of typing'} onPress={onSpeaking} />
          <NavRow label="Voices" detail="The voices each language is recorded and read aloud with" onPress={onVoices} />
          <NavRow
            label="Study reminder"
            detail={!reminder ? undefined : reminder.on ? `Every day at ${reminderTime(reminder)}` : "Off. A notification each day with how many cards are waiting"}
            onPress={onReminder}
          />
          <NavRow label="Vacation mode" detail={vacation ? vacationDetail(vacation, today) : undefined} onPress={onVacation} />
        </Group>
        <SectionTitle>Omnilanguage cards</SectionTitle>
        <Group>
          <SwitchRow
            first
            label="Swipe to answer"
            hint="After the answer is shown, drag the card right for Good or left for Again."
            value={!!swipe}
            onValueChange={chooseSwipe}
          />
          <SwitchRow
            label="Show romanization and translation"
            hint="On the answer, without a tap. Off, each waits for a tap on every card."
            value={!!hints}
            onValueChange={chooseHints}
          />
          <SwitchRow
            label="Ask for your own hook"
            hint="On a new word's first answer, offer a line for a mnemonic of your own, saved to the note's Mnemonic."
            value={!!hook}
            onValueChange={chooseHook}
          />
          <NavRow label="Thai text size" detail={THAI_TEXT_CHOICES.find((x) => x.value === thaiSize)?.label} onPress={onThaiSize} />
        </Group>
        <Help>These apply to Omnilanguage cards. Other note types use the buttons and their own templates.</Help>
      </ScrollView>
    </Screen>
  );
}
