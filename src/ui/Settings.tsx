import { useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, Text } from 'react-native';
import { ANSWER_BUTTON_CHOICES, type AnswerButtons } from '../core/answerButtons';
import { failureText } from '../core/failure';
import { THAI_TEXT_CHOICES, thaiTextStyle, type ThaiTextSize } from '../core/script';
import type { Repo } from '../db/repo';
import { CheckRow, Group, Help, NavRow, Screen, SectionTitle, SwitchRow } from './kit';
import { reminderTime, useReminderPrefs } from './studyReminder';
import { space, useTheme } from './theme';

/**
 * App-wide settings: the screens that aren't about studying (Anki, Backup, Read & Listen, WaniKani), the
 * voices cards are read aloud with, the study reminder, and which answer buttons Review shows.
 */
export function Settings({ repo, backupText, readerOn, wanikaniOn, onAnki, onBackup, onRead, onWaniKani, onVoices, onReminder, onSpeaking }: {
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
  onSpeaking: () => void;
}) {
  const c = useTheme();
  const [buttons, setButtons] = useState<AnswerButtons>();
  const [swipe, setSwipe] = useState<boolean>();
  const [hints, setHints] = useState<boolean>();
  const [hook, setHook] = useState<boolean>();
  const [speaking, setSpeaking] = useState<boolean>();
  const [thaiSize, setThaiSize] = useState<ThaiTextSize>();
  const reminder = useReminderPrefs();
  // Read each time Settings shows: it's changed on the Speaking screen, over this one.
  useFocusEffect(useCallback(() => { repo.answerBySpeaking().then(setSpeaking).catch(() => undefined); }, [repo]));

  useEffect(() => { repo.answerButtons().then(setButtons); repo.swipeToRate().then(setSwipe); repo.showCardHints().then(setHints); repo.askOwnHook().then(setHook); repo.thaiTextSize().then(setThaiSize); }, [repo]);

  // Saved first, then shown, so the screen never shows a setting that isn't stored.
  const save = async (write: () => Promise<void>, show: () => void) => {
    try {
      await write();
      show();
    } catch (e) {
      Alert.alert("Couldn't save this setting", failureText(e, { next: 'Try again.' }));
    }
  };
  const choose = (value: AnswerButtons) => save(() => repo.saveAnswerButtons(value), () => setButtons(value));
  const chooseSwipe = (on: boolean) => save(() => repo.saveSwipeToRate(on), () => setSwipe(on));
  const chooseHints = (on: boolean) => save(() => repo.saveShowCardHints(on), () => setHints(on));
  const chooseHook = (on: boolean) => save(() => repo.saveAskOwnHook(on), () => setHook(on));
  const chooseThai = (value: ThaiTextSize) => save(() => repo.saveThaiTextSize(value), () => setThaiSize(value));

  return (
    <Screen title="Settings">
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.m }}>
        <Group>
          {/* The tile colors are the rating colors: each is picked so white reads on it in light and dark. */}
          <NavRow first icon={{ name: 'arrow.triangle.2.circlepath', color: c.easy }} label="Anki" detail="Sync, or send your collection to and from Anki by file" onPress={onAnki} />
          <NavRow icon={{ name: 'externaldrive.fill', color: c.hard }} label="Backup" detail={backupText ?? 'Save or restore everything in Franki'} onPress={onBackup} />
          <NavRow icon={{ name: 'book.fill', color: c.again }} label="Read & Listen" detail={readerOn ? 'On' : 'Off. Texts to read and listen to, written from your decks'} onPress={onRead} />
          <NavRow icon={{ name: 'character.ja', color: c.violet }} label="WaniKani" detail={wanikaniOn ? 'On' : 'Off. Study your WaniKani reviews and lessons as a deck'} onPress={onWaniKani} />
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
          <SwitchRow
            label="Show romanization and translation"
            hint="On the answer, show a word's romanization and its example sentence's romanization and translation without tapping. Off, each one waits for a tap on every card. Only for Omnilanguage cards."
            value={!!hints}
            onValueChange={chooseHints}
          />
          <SwitchRow
            label="Ask for your own hook"
            hint="The first time a new word's answer is shown, offer a line for a mnemonic of your own, saved to the note's Mnemonic. Only for Omnilanguage cards."
            value={!!hook}
            onValueChange={chooseHook}
          />
          <NavRow label="Speaking" detail={speaking === undefined ? undefined : speaking ? 'On. Answer by speaking' : 'Off. Answer by speaking instead of typing'} onPress={onSpeaking} />
          <NavRow label="Voices" detail="The voices each language is recorded and read aloud with" onPress={onVoices} />
          <NavRow
            label="Study reminder"
            detail={!reminder ? undefined : reminder.on ? `Every day at ${reminderTime(reminder)}` : "Off. A notification each day with how many cards are waiting"}
            onPress={onReminder}
          />
        </Group>
        <SectionTitle>Thai text size</SectionTitle>
        <Group accessibilityRole="radiogroup">
          {THAI_TEXT_CHOICES.map((choice, i) => (
            <CheckRow
              key={choice.value}
              first={i === 0}
              label={choice.label}
              selected={thaiSize === choice.value}
              onPress={() => chooseThai(choice.value)}
            />
          ))}
        </Group>
        <Text style={{ ...thaiTextStyle(thaiSize ?? 'large'), color: c.text, paddingHorizontal: space.l }}>วันแรกผมหลงทาง</Text>
        <Help>
          How large Thai is on a card: a word's example sentence and any field with Thai in it. The word itself
          on the front and back of a card keeps its own size.
        </Help>
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
