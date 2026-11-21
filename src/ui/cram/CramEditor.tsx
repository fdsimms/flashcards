import { DatePicker, Host } from '@expo/ui/swift-ui';
import { Stack, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, Text, useColorScheme, View } from 'react-native';
import {
  CRAM_LANGUAGE_CHOICES, carryOver, cramDay, cramId, cramNotes, cramProblem, dayChoices, lastCramLanguage, MISSED_MAX, standInName, type Cram,
} from '../../core/cram';
import { dayKeyOf, studyDayStart } from '../../core/day';
import { failureText } from '../../core/failure';
import type { AppRepo } from '../AppContext';
import { haptic } from '../haptics';
import { Button, Card, Field, Group, Help, Screen, Select, SwitchRow } from '../kit';
import { LANGUAGES } from '../../reader/languages';
import { readable, space, type, useTheme } from '../theme';
import { capCramCards, deleteCram, saveCram, startCram, useCollection, useCramClock, useCrams } from '../useCrams';
import { CheckRow, Pill } from './CramBits';
import { useMissedLately } from './useMissedLately';
import { leaveScreen } from '../leaveScreen';
import { PRACTICE_PATH } from '../tabPaths';

const ANY_LANGUAGE = 'Any language';

/**
 * A cram's sheet. A new one is one step: what it's for, the day (a chip for each of the next five
 * days, or Other for the calendar), the language (the last cram's, to start), and which words it
 * starts with (the ones not used last time; the ones missed lately, unchecked to start, since they're
 * seldom about the topic), then Start cram opens its page, where everything else is planned. With
 * nothing to talk about in mind, "Not sure yet? Get ideas" starts it under a stand-in name and opens
 * its talking points; the theme used names it (`withThemes`). Editing one changes its name, day and
 * language, whether new cards join it, and can delete it.
 */
export function CramEditor({ repo, id, canSuggest }: {
  repo: AppRepo;
  id?: string;
  /** Read & Listen is on, so talking points can be asked for. */
  canSuggest: boolean;
}) {
  const c = useTheme();
  const dark = useColorScheme() === 'dark';
  const router = useRouter();
  const { crams, loaded } = useCrams(repo);
  const { now, dayStartsAtHour: H } = useCramClock(repo);
  const collection = useCollection(repo);
  const editing = id ? crams.find((x) => x.id === id) : undefined;
  const days = dayChoices(now, H);
  const [name, setName] = useState('');
  const [date, setDate] = useState(() => days[1].date);
  const [otherDay, setOtherDay] = useState(false);
  const [addNew, setAddNew] = useState(true);
  const [language, setLanguage] = useState<Cram['language']>();
  const [carry, setCarry] = useState(true);
  const [missed, setMissed] = useState(false);
  const [busy, setBusy] = useState(false);
  // The footer's height: the scroll content is padded by it so Delete cram can scroll clear of Save.
  const [footerHeight, setFooterHeight] = useState(0);
  const [problem, setProblem] = useState<string>();
  const newId = useRef<string | undefined>(undefined);
  const picked = useRef(false);

  // An edit starts from the cram as saved; a new one in the last cram's language.
  useEffect(() => {
    if (!editing) return;
    setName(editing.name);
    setDate(editing.date);
    setOtherDay(!days.some((d) => d.date === editing.date));
    setAddNew(editing.addNew);
    setLanguage(editing.language);
  }, [editing?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (id || picked.current || !loaded || !collection.loaded) return;
    setLanguage(lastCramLanguage(crams, collection.notes));
  }, [id, loaded, collection.loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const noteIds = useMemo(() => new Set(collection.notes.map((n) => n.id)), [collection.notes]);
  const carried = editing ? undefined : carryOver(crams, noteIds);
  const missedIds = useMissedLately(repo, editing ? undefined : language)
    .filter((nid) => noteIds.has(nid) && !carried?.noteIds.includes(nid))
    .slice(0, MISSED_MAX);
  const languageName = language ? LANGUAGES[language].name : undefined;

  const save = async (ideas = false) => {
    if (busy) return;
    // No name yet: a stand-in the theme used replaces (`withThemes`).
    const title = ideas ? standInName(languageName) : name;
    // A cram's own day, unchanged, can be kept when it's past (renaming a finished cram).
    const keptDay = !!editing && date === editing.date;
    const wrong = keptDay && title.trim() ? undefined : cramProblem(title, date, now, H);
    if (wrong) { setProblem(wrong); return; }
    haptic.tap();
    setBusy(true);
    setProblem(undefined);
    try {
      if (editing) {
        // A name typed over the stand-in is the owner's: a theme no longer replaces it.
        const renamed = name.trim() !== editing.name;
        await saveCram(repo, { ...editing, name: name.trim(), date, addNew, language, ...(renamed ? { untitled: undefined } : {}) });
        // Saved either way; the cram's page runs the cap again and says if it can't.
        capCramCards(repo).catch(() => undefined);
        leaveScreen(router, PRACTICE_PATH);
        return;
      }
      // Kept for a second try: the cram is saved before its words are tagged, so a try that failed
      // part way is finished by the next one rather than making a second cram.
      newId.current ??= cramId(title, date, crams.map((x) => x.id));
      const takeCarried = !!carried && carry;
      const cram: Cram = {
        id: newId.current,
        name: title.trim(),
        date,
        createdAt: new Date().toISOString(),
        ...(ideas ? { untitled: true } : {}),
        addNew,
        ...(language ? { language } : {}),
        rounds: [],
        ...(takeCarried ? { carriedIn: carried.noteIds } : {}),
      };
      const words = [...(takeCarried ? carried.noteIds : []), ...(missed ? missedIds : [])];
      await startCram(repo, cram, words, takeCarried ? carried.from : undefined);
      capCramCards(repo).catch(() => undefined);
      router.replace({ pathname: '/cram', params: { id: cram.id } });
      if (ideas) router.push({ pathname: '/cram-themes', params: { id: cram.id } });
    } catch (e) {
      setProblem(failureText(e, { what: "Couldn't save the cram.", next: 'Try again.' }));
      setBusy(false);
    }
  };

  const remove = () => {
    if (!editing) return;
    Alert.alert(`Delete ${editing.name}?`, 'Its tag comes off its words. The words and their cards stay as they are.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await deleteCram(repo, editing, cramNotes(editing, collection.notes));
            leaveScreen(router, PRACTICE_PATH);
          } catch (e) {
            setProblem(failureText(e, { what: "Couldn't delete the cram.", next: 'Try again.' }));
            setBusy(false);
          }
        },
      },
    ]);
  };

  const ready = loaded && collection.loaded && (!id || !!editing);
  const pickDay = (d: string) => { haptic.select(); setOtherDay(false); setDate(d); };
  return (
    <Screen
      title={editing ? 'Edit cram' : 'New cram'}
      largeTitle={false}
      onFooterLayout={setFooterHeight}
      toolbar={(
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button accessibilityLabel="Cancel" onPress={() => leaveScreen(router, PRACTICE_PATH)}>Cancel</Stack.Toolbar.Button>
        </Stack.Toolbar>
      )}
      footer={(
        <>
          {problem ? <Text style={{ ...type.subhead, color: c.danger }}>{problem}</Text> : null}
          <Button label={editing ? 'Save' : 'Start cram'} onPress={() => void save()} busy={busy} disabled={!ready} />
        </>
      )}
    >
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ ...readable, padding: space.l, paddingBottom: space.l + footerHeight, gap: space.l }}>
        <Card>
          <Field label="What's it for?" value={name} onChangeText={setName} placeholder="e.g. Talking about my weekend" autoFocus={!id} returnKeyType="done" />
          {!editing && canSuggest && !name.trim() ? (
            <>
              <Button variant="secondary" label="Not sure yet? Get ideas" onPress={() => void save(true)} disabled={!ready || !language || busy} />
              <Help>{language ? 'Starts the cram and suggests things to talk about from your words. The one you use names it.' : 'Choose a language below first.'}</Help>
            </>
          ) : null}
        </Card>
        <View style={{ gap: space.s }}>
          <Text style={{ ...type.subhead, color: c.textSecondary }}>Day</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
            {days.map((d) => <Pill key={d.date} label={d.label} selected={!otherDay && date === d.date} onPress={() => pickDay(d.date)} />)}
            <Pill label="Other" icon="calendar" selected={otherDay} onPress={() => { haptic.select(); setOtherDay(true); }} accessibilityLabel="Another day" />
          </View>
          {otherDay ? (
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 44 }}>
                <Text style={{ ...type.body, color: c.text, flex: 1 }}>Day</Text>
                <Host matchContents colorScheme={dark ? 'dark' : 'light'} seedColor={c.accent}>
                  <DatePicker
                    selection={cramDay({ date })}
                    range={{ start: studyDayStart(now, H) }}
                    displayedComponents={['date']}
                    onDateChange={(d) => setDate(dayKeyOf(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12)))}
                  />
                </Host>
              </View>
            </Card>
          ) : null}
        </View>
        <Card>
          <Select
            label="Language"
            options={[ANY_LANGUAGE, ...CRAM_LANGUAGE_CHOICES.map((x) => x.label)]}
            value={CRAM_LANGUAGE_CHOICES.find((x) => x.code === language)?.label ?? ANY_LANGUAGE}
            onChange={(v) => { picked.current = true; setLanguage(CRAM_LANGUAGE_CHOICES.find((x) => x.label === v)?.code); }}
          />
          <Help>{languageName ? `Add offers only ${languageName} words, and new ${languageName} cards join it.` : 'Add offers every word, and only new cards in no language join it.'}</Help>
        </Card>
        {!editing && (carried || missedIds.length) ? (
          <View style={{ gap: space.s }}>
            <Text style={{ ...type.subhead, color: c.textSecondary }}>Start with</Text>
            <Group>
              {carried ? (
                <CheckRow
                  first
                  label={`${carried.noteIds.length === 1 ? '1 word' : `${carried.noteIds.length} words`} you didn't use last time`}
                  detail={`From ${carried.from.name}`}
                  checked={carry}
                  onPress={() => { haptic.select(); setCarry(!carry); }}
                />
              ) : null}
              {missedIds.length ? (
                <CheckRow
                  first={!carried}
                  label={`${missedIds.length === 1 ? '1' : missedIds.length} ${languageName ?? ''} ${missedIds.length === 1 ? 'word' : 'words'} you missed lately`.replace(/\s+/g, ' ')}
                  detail="Answered Again in Review, most missed first"
                  checked={missed}
                  onPress={() => { haptic.select(); setMissed(!missed); }}
                />
              ) : null}
            </Group>
          </View>
        ) : null}
        {!editing ? <Help>Add words, questions for your tutor and things to talk about on the cram's page.</Help> : null}
        {editing ? (
          <Group>
            <SwitchRow first label="New cards join it" hint={languageName ? `${languageName} cards you add before the day get this cram's tag.` : "Cards you add before the day get this cram's tag."} value={addNew} onValueChange={setAddNew} />
          </Group>
        ) : null}
        <Help>Until the day, a review of these words is due no later than that day. Afterwards they keep their usual schedule.</Help>
        {editing ? <Button variant="destructive" label="Delete cram" onPress={remove} disabled={busy} /> : null}
      </ScrollView>
    </Screen>
  );
}
