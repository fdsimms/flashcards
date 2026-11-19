import { DatePicker, Host } from '@expo/ui/swift-ui';
import { Stack, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, Text, useColorScheme, View } from 'react-native';
import type { NoteStore } from '../../anki/noteService';
import { carryOver, cramDay, cramId, cramNotes, cramProblem, type Cram } from '../../core/cram';
import { talkOf, themeDeckWords } from '../../core/cramThemes';
import { dayKeyOf, studyDayStart } from '../../core/day';
import { failureText } from '../../core/failure';
import { noteHasTag, tagCounts } from '../../core/priority';
import { parseTags } from '../../core/noteEditing';
import { haptic } from '../haptics';
import { Button, Card, Field, Group, Help, Screen, Segments, SwitchRow } from '../kit';
import { TagTokenField } from '../TagTokenField';
import { readable, space, type, useTheme } from '../theme';
import { capCramCards, deleteCram, saveCram, startCram, useCollection, useCramClock, useCrams } from '../useCrams';
import { CramThemeCard } from './CramThemeCard';
import { setThemeState, useThemeState } from './themeStore';

type Source = 'new' | 'pick' | 'tag';

/**
 * A cram's sheet: its name, its day, and whether new cards join it; for a new one, also which words
 * it starts with (none yet, picked next, or the notes with a tag) and whether the words not used at
 * the last cram come too. Editing one can delete it. Saving a new one opens it (or the word picker).
 * A new one can start from a theme to talk about (`onSuggest` opens the ideas; they're Read & Listen's,
 * so it's left out while that's off): the theme's title is the name, its words the first words.
 */
export function CramEditor({ repo, id, onSuggest }: { repo: NoteStore; id?: string; onSuggest?: () => void }) {
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
  const { chosen } = useThemeState();
  const theme = id ? undefined : chosen;

  // A theme picked on the ideas screen names the cram, and goes when this sheet does: the next new cram starts clean.
  useEffect(() => { if (theme) setName(theme.theme.title); }, [theme?.theme.title]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => setThemeState({ chosen: undefined }), []);

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
  const counts = useMemo(() => tagCounts(collection.notes), [collection.notes]);
  const tagged = source === 'tag' && tags.length ? collection.notes.filter((n) => tags.some((t) => noteHasTag(n, t))) : [];
  // The theme's words still in the collection (one deleted since the ideas were written is left out).
  const themeIds = useMemo(() => (theme ? themeDeckWords(theme.theme, theme.words).map((w) => w.noteId).filter((nid) => noteIds.has(nid)) : []), [theme, noteIds]);

  const save = async () => {
    if (busy) return;
    const dateKey = dayKeyOf(date);
    // A cram's own day, unchanged, can be kept when it's past (renaming a finished cram).
    const keptDay = !!editing && dateKey === editing.date;
    const wrong = keptDay && name.trim() ? undefined : cramProblem(name, dateKey, now, H);
    if (wrong) { setProblem(wrong); return; }
    if (!editing && source === 'tag' && !tagged.length) { setProblem(tags.length ? 'No notes have those tags.' : 'Add a tag, or choose another way to add words.'); return; }
    haptic.tap();
    setBusy(true);
    setProblem(undefined);
    try {
      if (editing) {
        await saveCram(repo, { ...editing, name: name.trim(), date: dateKey, addNew });
        // Saved either way; the cram's page runs the cap again and says if it can't.
        capCramCards(repo).catch(() => undefined);
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
        ...(theme ? { theme: talkOf(theme.theme) } : {}),
      };
      const words = [...(carried && carry ? carried.noteIds : []), ...tagged.map((n) => n.id), ...themeIds];
      await startCram(repo, cram, words, carried && carry ? carried.from : undefined);
      capCramCards(repo).catch(() => undefined);
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
          <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Ordering spicy food" autoFocus={!id} returnKeyType="done" />
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
        {!editing && (onSuggest || theme) ? (
          <CramThemeCard
            picked={theme ? { title: theme.theme.title, words: themeIds.length, questions: theme.theme.questions.length } : undefined}
            onSuggest={() => { haptic.tap(); onSuggest?.(); }}
            onRemove={() => { haptic.tap(); setThemeState({ chosen: undefined }); }}
          />
        ) : null}
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
            <Text style={{ ...type.subhead, color: c.textSecondary }}>Words</Text>
            <Segments<Source>
              options={[{ value: 'new', label: 'None yet' }, { value: 'pick', label: 'Select' }, { value: 'tag', label: 'By tag' }]}
              value={source}
              onChange={setSource}
            />
            {source === 'new' ? <Help>Add words later from the cram's page, or as you add new cards.</Help> : null}
            {source === 'pick' ? <Help>Once it's saved, you select the words from your decks.</Help> : null}
            {source === 'tag' ? (
              <>
                <TagTokenField label="Tags" tags={tags} onChange={(t) => setTag(t.join(' '))} counts={counts} placeholder="e.g. lesson-12" />
                <Help>{tags.length ? `${tagged.length === 1 ? '1 note has' : `${tagged.length} notes have`} it.` : 'Notes with any of these tags join the cram.'}</Help>
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
