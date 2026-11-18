import { DatePicker, Host } from '@expo/ui/swift-ui';
import { Stack, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, Text, useColorScheme, View } from 'react-native';
import type { NoteStore } from '../../anki/noteService';
import { carryOver, cramDay, cramId, cramNotes, cramProblem, type Cram } from '../../core/cram';
import { dayKeyOf, studyDayStart } from '../../core/day';
import { failureText } from '../../core/failure';
import { noteHasTag } from '../../core/priority';
import { parseTags } from '../../core/noteEditing';
import { haptic } from '../haptics';
import { Button, Card, Field, Group, Help, Screen, Segments, SwitchRow } from '../kit';
import { readable, space, type, useTheme } from '../theme';
import { capCramCards, deleteCram, saveCram, startCram, useCollection, useCramClock, useCrams } from '../useCrams';

type Source = 'new' | 'pick' | 'tag';

/**
 * A cram's sheet: its name, its day, and whether new cards join it; for a new one, also which words
 * it starts with (none yet, picked next, or the notes with a tag) and whether the words not used at
 * the last cram come too. Editing one can delete it. Saving a new one opens it (or the word picker).
 */
export function CramEditor({ repo, id }: { repo: NoteStore; id?: string }) {
  const c = useTheme();
  const dark = useColorScheme() === 'dark';
  const router = useRouter();
  const { crams, loaded } = useCrams(repo);
  const { now, dayStartsAtHour: H } = useCramClock(repo);
  const collection = useCollection(repo);
  const editing = id ? crams.find((x) => x.id === id) : undefined;
  const [name, setName] = useState('');
  const [date, setDate] = useState(() => new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 12));
  const [addNew, setAddNew] = useState(true);
  const [source, setSource] = useState<Source>('new');
  const [tag, setTag] = useState('');
  const [carry, setCarry] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const newId = useRef<string | undefined>(undefined);

  // An edit starts from the cram as saved.
  useEffect(() => {
    if (!editing) return;
    setName(editing.name);
    setDate(cramDay(editing));
    setAddNew(editing.addNew);
  }, [editing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const noteIds = useMemo(() => new Set(collection.notes.map((n) => n.id)), [collection.notes]);
  const carried = editing ? undefined : carryOver(crams, noteIds);
  const tags = parseTags(tag);
  const tagged = source === 'tag' && tags.length ? collection.notes.filter((n) => tags.some((t) => noteHasTag(n, t))) : [];

  const save = async () => {
    if (busy) return;
    const dateKey = dayKeyOf(date);
    // A cram's own day, unchanged, can be kept when it's past (renaming a finished cram).
    const keptDay = !!editing && dateKey === editing.date;
    const wrong = keptDay && name.trim() ? undefined : cramProblem(name, dateKey, now, H);
    if (wrong) { setProblem(wrong); return; }
    if (!editing && source === 'tag' && !tagged.length) { setProblem(tags.length ? 'No notes have that tag.' : 'Type a tag, or choose another way to add words.'); return; }
    haptic.tap();
    setBusy(true);
    setProblem(undefined);
    try {
      if (editing) {
        await saveCram(repo, { ...editing, name: name.trim(), date: dateKey, addNew });
        await capCramCards(repo);
        router.back();
        return;
      }
      // Kept for a second try: the cram is saved before its words are tagged, so a try that failed
      // part way is finished by the next one rather than making a second cram.
      newId.current ??= cramId(name, dateKey, crams.map((x) => x.id));
      const cram: Cram = {
        id: newId.current,
        name: name.trim(),
        date: dateKey,
        createdAt: new Date().toISOString(),
        addNew,
        rounds: [],
        ...(carried && carry ? { carriedIn: carried.noteIds } : {}),
      };
      const words = [...(carried && carry ? carried.noteIds : []), ...tagged.map((n) => n.id)];
      await startCram(repo, cram, words, carried && carry ? carried.from : undefined);
      router.replace({ pathname: source === 'pick' ? '/cram-words' : '/cram', params: { id: cram.id } });
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
            router.back();
          } catch (e) {
            setProblem(failureText(e, { what: "Couldn't delete the cram.", next: 'Try again.' }));
            setBusy(false);
          }
        },
      },
    ]);
  };

  const ready = loaded && collection.loaded && (!id || !!editing);
  return (
    <Screen
      title={editing ? 'Edit cram' : 'New cram'}
      largeTitle={false}
      toolbar={(
        <>
          <Stack.Toolbar placement="left">
            <Stack.Toolbar.Button accessibilityLabel="Cancel" onPress={() => router.back()}>Cancel</Stack.Toolbar.Button>
          </Stack.Toolbar>
          <Stack.Toolbar placement="right">
            <Stack.Toolbar.Button accessibilityLabel="Save the cram" disabled={busy || !ready} onPress={save}>{busy ? 'Saving…' : 'Save'}</Stack.Toolbar.Button>
          </Stack.Toolbar>
        </>
      )}
    >
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ ...readable, padding: space.l, gap: space.m }}>
        <Card>
          <Field label="Name" value={name} onChangeText={setName} placeholder="For example Thai lesson" autoFocus={!id} returnKeyType="done" />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 44 }}>
            <Text style={{ ...type.body, color: c.text, flex: 1 }}>Day</Text>
            <Host matchContents colorScheme={dark ? 'dark' : 'light'} seedColor={c.accent}>
              <DatePicker
                selection={date}
                range={{ start: studyDayStart(now, H) }}
                displayedComponents={['date']}
                onDateChange={(d) => setDate(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12))}
              />
            </Host>
          </View>
        </Card>
        <Group>
          <SwitchRow first label="Add new cards to it" hint="Cards you add in the note editor until the day get this cram's tag." value={addNew} onValueChange={setAddNew} />
          {carried ? (
            <SwitchRow
              label={`${carried.noteIds.length === 1 ? '1 word' : `${carried.noteIds.length} words`} from ${carried.from.name}`}
              hint="Words you didn't use at your last cram."
              value={carry}
              onValueChange={setCarry}
            />
          ) : null}
        </Group>
        {!editing ? (
          <Card>
            <Text style={{ ...type.subhead, color: c.textSecondary }}>Start with</Text>
            <Segments<Source>
              options={[{ value: 'new', label: 'No words yet' }, { value: 'pick', label: 'Pick words' }, { value: 'tag', label: 'By tag' }]}
              value={source}
              onChange={setSource}
            />
            {source === 'new' ? <Help>Add words later from the cram's page, or as you add new cards.</Help> : null}
            {source === 'pick' ? <Help>Once it's saved, you pick the words from your decks.</Help> : null}
            {source === 'tag' ? (
              <>
                <Field label="Tag" value={tag} onChangeText={setTag} placeholder="For example lesson-12" autoCapitalize="none" autoCorrect={false} />
                <Help>{tags.length ? `${tagged.length === 1 ? '1 note has' : `${tagged.length} notes have`} it.` : 'Notes with this tag join the cram.'}</Help>
              </>
            ) : null}
          </Card>
        ) : null}
        <Help>
          Until the day, a review of these words is due no later than that day. Afterwards they keep their usual schedule. The words are kept as a tag starting with cram::, so Anki and Claude can add to them too.
        </Help>
        {problem ? <Text style={{ ...type.subhead, color: c.danger }}>{problem}</Text> : null}
        {editing ? <Button variant="destructive" label="Delete cram" onPress={remove} disabled={busy} /> : null}
      </ScrollView>
    </Screen>
  );
}
