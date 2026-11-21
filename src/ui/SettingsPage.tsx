import { useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView } from 'react-native';
import { ANSWER_BUTTON_CHOICES, type AnswerButtons } from '../core/answerButtons';
import { failureText } from '../core/failure';
import { THAI_TEXT_CHOICES, type ThaiTextSize } from '../core/script';
import type { FuriganaMode } from '../core/furigana';
import { settingsPage, type SettingsPageId } from '../core/settingsPages';
import type { Repo } from '../db/repo';
import { Group, Help, NavRow, Screen, SwitchRow } from './kit';
import { reminderTime, useReminderPrefs } from './studyReminder';
import { useStudyToday, useVacationPrefs } from './vacationPrefs';
import { vacationDetail } from './vacationNotice';
import { space, readable } from './theme';

/**
 * One page's settings: what the gear in a tab's header opens, and what the page's row in Settings
 * opens. Which settings are on which page is `src/core/settingsPages.ts`; the rows are written out
 * here because each keeps its own state and its own "Couldn't save" alert. A setting that has a screen
 * of its own is a row that opens it.
 */
export function SettingsPage({ page, repo, readerOn, dailySummary, lessonRows, onOpen }: {
  page: SettingsPageId;
  repo: Repo;
  /** Whether Read & Listen is turned on. */
  readerOn: boolean;
  /** What the Daily reading tasks row says (`dailyTasksSummary`), null from a server older than the setting. */
  dailySummary: string | null;
  /** The Lessons page's rows (`LessonSettingsRows`), made by the route: they come from Read & Listen's side of the app, which this file doesn't import. */
  lessonRows: React.ReactNode;
  /** Opens a screen by its route. */
  onOpen: (route: string) => void;
}) {
  return (
    <Screen title={settingsPage(page)?.title ?? 'Settings'}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.m }}>
        {page === 'today' ? <TodayRows onOpen={onOpen} /> : null}
        {page === 'decks' ? <DeckRows repo={repo} onOpen={onOpen} /> : null}
        {page === 'read' ? <ReadRows readerOn={readerOn} dailySummary={dailySummary} onOpen={onOpen} /> : null}
        {page === 'lessons' ? lessonRows : null}
        {page === 'practice' ? (
          <Group>
            <NavRow first label="Daily extras" detail="Drills and a text to read, besides your cards" onPress={() => onOpen('/extras')} />
          </Group>
        ) : null}
        <Group>
          <NavRow first label="All settings" detail="Every page's settings, and search" onPress={() => onOpen('/settings')} />
        </Group>
      </ScrollView>
    </Screen>
  );
}

function TodayRows({ onOpen }: { onOpen: (route: string) => void }) {
  const reminder = useReminderPrefs();
  const vacation = useVacationPrefs();
  const { today } = useStudyToday();
  return (
    <Group>
      <NavRow
        first
        label="Study reminder"
        loading={!reminder}
        detail={!reminder ? undefined : reminder.on ? `Every day at ${reminderTime(reminder)}` : 'Off. A notification each day with how many cards are waiting'}
        onPress={() => onOpen('/reminder')}
      />
      <NavRow label="Vacation mode" loading={!vacation} detail={vacation ? vacationDetail(vacation, today) : undefined} onPress={() => onOpen('/vacation')} />
    </Group>
  );
}

function DeckRows({ repo, onOpen }: { repo: Repo; onOpen: (route: string) => void }) {
  const [buttons, setButtons] = useState<AnswerButtons>();
  const [swipe, setSwipe] = useState<boolean>();
  const [hints, setHints] = useState<boolean>();
  const [hook, setHook] = useState<boolean>();
  const [thaiSize, setThaiSize] = useState<ThaiTextSize>();
  const [furigana, setFurigana] = useState<FuriganaMode>();
  // Read each time the page shows: they're changed on screens over this one.
  useFocusEffect(useCallback(() => {
    repo.answerButtons().then(setButtons).catch(() => undefined);
    repo.thaiTextSize().then(setThaiSize).catch(() => undefined);
    repo.furiganaMode().then(setFurigana).catch(() => undefined);
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
  return (
    <>
      <Group>
        <NavRow first label="Answer buttons" loading={buttons === undefined} detail={ANSWER_BUTTON_CHOICES.find((x) => x.value === buttons)?.label} onPress={() => onOpen('/answer-buttons')} />
      </Group>
      <Group>
        <SwitchRow
          first
          label="Swipe to answer"
          hint="After the answer is shown, drag the card right for Good or left for Again."
          value={!!swipe}
          onValueChange={(on) => save(() => repo.saveSwipeToRate(on), () => setSwipe(on))}
        />
        <SwitchRow
          label="Show romanization and translation"
          hint="Show them on the answer without a tap."
          value={!!hints}
          onValueChange={(on) => save(() => repo.saveShowCardHints(on), () => setHints(on))}
        />
        <SwitchRow
          label="Ask for your own mnemonic"
          hint="The first time you see a new word, ask for a mnemonic of your own. It's shown on the back after that."
          value={!!hook}
          onValueChange={(on) => save(() => repo.saveAskOwnHook(on), () => setHook(on))}
        />
        <NavRow label="Thai text size" loading={thaiSize === undefined} detail={THAI_TEXT_CHOICES.find((x) => x.value === thaiSize)?.label} onPress={() => onOpen('/thai-text-size')} />
        <NavRow label="Furigana" loading={furigana === undefined} detail={furigana === 'off' ? 'Off' : furigana === 'all' ? 'Every kanji' : furigana ? 'Not learned' : undefined} onPress={() => onOpen('/furigana')} />
      </Group>
      <Help>These apply to Omnilanguage cards. Other note types use the answer buttons and their own templates.</Help>
      <Group>
        <NavRow first label="Note types" detail="How each note type's cards look: templates and styling" onPress={() => onOpen('/note-types')} />
      </Group>
    </>
  );
}

function ReadRows({ readerOn, dailySummary, onOpen }: { readerOn: boolean; dailySummary: string | null; onOpen: (route: string) => void }) {
  return (
    <Group>
      <NavRow first label="Server" detail={readerOn ? 'On. Turn off, or share counts with dundundun' : 'Off. Texts to read and listen to, written from your decks'} onPress={() => onOpen('/read-settings')} />
      {readerOn ? (
        <>
          <NavRow label="Reading and listening" detail="Voices, highlighting, slow speed, meanings, word forms" onPress={() => onOpen('/read-listening')} />
          <NavRow label="Daily reading tasks" detail={dailySummary ?? 'Which languages get a task each day'} onPress={() => onOpen('/read-daily-tasks')} />
          <NavRow label="Language settings" detail="Grammar, vocabulary and voices for the language you're reading" onPress={() => onOpen('/read-language')} />
        </>
      ) : null}
    </Group>
  );
}
