import { Stack, useRouter } from 'expo-router';
import React, { useMemo, useRef, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import type { NoteStore } from '../../anki/noteService';
import { addableNotes, cramLanguageOf, cramNotes, cramTag, meaningOf, noteAddedAt, searchNotes, withRequest } from '../../core/cram';
import { failureText } from '../../core/failure';
import { headword } from '../../core/forms';
import type { LessonWordCandidate } from '../../core/lessonWords';
import { noteHasTag, tagCounts } from '../../core/priority';
import type { Note } from '../../core/types';
import type { Language, QueuedNote } from '../../reader/api';
import { LANGUAGES } from '../../reader/languages';
import { haptic } from '../haptics';
import { Field, Group, Help, Loading, NavRow, Screen } from '../kit';
import { radius, readable, space, type, useTheme } from '../theme';
import { capCramCards, cramsNow, saveCram, setCramTag, useCollection, useCrams } from '../useCrams';
import { useKeyboardScroll } from '../useKeyboardScroll';
import { CheckRow } from './CramBits';
import { CramAsk } from './CramAsk';
import { leaveScreen } from '../leaveScreen';
import { PRACTICE_PATH } from '../tabPaths';

/** How many notes the list shows at once: a search narrows it. */
const SHOWN = 60;

/**
 * Add, on a cram's page: type a word, a meaning or something to say, in the language or English.
 * Notes in the cram's language match by word or by a whole word of the meaning (`searchNotes`); a
 * tap adds the cram's tag or takes it off, the check showing at once and put back, with the reason,
 * if the note can't be saved. What's typed can also be a tag ("Add all 12 tagged italki"), or, with
 * Read & Listen on, a card for Claude to write (`CramAsk`). Nothing typed: the newest notes.
 */
export function CramWords({ repo, id, initial, findWords, queue, queued, approve }: {
  repo: NoteStore;
  id: string;
  /** What the field starts with (a word typed in the lesson, from the cram's page). */
  initial?: string;
  /** Find word's lookup, while Read & Listen is on. */
  findWords?: (language: Language, text: string) => Promise<LessonWordCandidate[]>;
  /** Sends a word to the note queue in the language's deck, while Read & Listen is on and has one. */
  queue?: (language: Language, entries: { entry: string; meaning: string }[]) => Promise<'queued' | 'held' | undefined>;
  /** The note queue as the server last said it, so a card asked for here shows when it's ready. */
  queued?: QueuedNote[];
  /** Opens a ready queued note in the note editor and takes it off the queue once saved; true when it was saved. */
  approve?: (note: QueuedNote) => Promise<boolean>;
}) {
  const c = useTheme();
  const router = useRouter();
  const { crams } = useCrams(repo);
  const collection = useCollection(repo);
  // The keyboard's height as padding under the list, so the Make cards button can be scrolled above it.
  const { bottomPadding } = useKeyboardScroll();
  const cram = crams.find((x) => x.id === id);
  const [query, setQuery] = useState(initial ?? '');
  // What each tap asked for, shown until the notes are read again and agree; a note being saved
  // takes no second tap, so an add and a take-out of one note can't race.
  const [asked, setAsked] = useState<Map<string, boolean>>(new Map());
  const saving = useRef(new Set<string>());
  const [problem, setProblem] = useState<string>();

  const inCram = useMemo(() => (cram ? cramNotes(cram, collection.notes) : []), [cram, collection.notes]);
  const inCramIds = useMemo(() => new Set(inCram.map((n) => n.id)), [inCram]);
  const language = cram && collection.loaded ? cramLanguageOf(cram, collection.notes) : undefined;
  const offered = useMemo(() => addableNotes(collection.notes, inCram, language), [collection.notes, inCram, language]);
  const typed = query.trim();
  const rows = useMemo(
    () => (typed ? searchNotes(offered, typed, SHOWN) : [...offered].sort((a, b) => noteAddedAt(b) - noteAddedAt(a)).slice(0, SHOWN)),
    [offered, typed],
  );
  const counts = useMemo(() => tagCounts(collection.notes), [collection.notes]);
  const tagMatch = typed && !/\s/.test(typed) ? counts.find((t) => t.tag.toLowerCase() === typed.toLowerCase().replace(/^#/, ''))?.tag : undefined;
  const tagged = useMemo(() => (tagMatch ? offered.filter((n) => noteHasTag(n, tagMatch) && !inCramIds.has(n.id)) : []), [tagMatch, offered, inCramIds]);
  const exact = typed && rows.some((n) => headword(n).trim().toLowerCase() === typed.toLowerCase());

  if (!cram || !collection.loaded) return <Screen title="Add" largeTitle={false}><Loading /></Screen>;
  const tag = cramTag(cram);
  const checked = (note: Note) => asked.get(note.id) ?? inCramIds.has(note.id);
  const toggle = async (note: Note) => {
    if (saving.current.has(note.id)) return;
    const on = !checked(note);
    saving.current.add(note.id);
    haptic.select();
    setProblem(undefined);
    setAsked((p) => new Map(p).set(note.id, on));
    try {
      await setCramTag(repo, cram, [note.id], on);
      collection.reload();
      if (on) capCramCards(repo).catch(() => undefined);
    } catch (e) {
      setAsked((p) => { const next = new Map(p); next.delete(note.id); return next; });
      setProblem(failureText(e, { what: `Couldn't ${on ? 'add' : 'take out'} ${headword(note)}.`, next: 'Try again.' }));
    } finally {
      saving.current.delete(note.id);
    }
  };
  const addTagged = async () => {
    haptic.tap();
    setProblem(undefined);
    try {
      await setCramTag(repo, cram, tagged.map((n) => n.id), true);
      collection.reload();
      capCramCards(repo).catch(() => undefined);
    } catch (e) {
      setProblem(failureText(e, { what: "Couldn't add the words.", next: 'Try again.' }));
    }
  };
  const ask = async (words: LessonWordCandidate[]) => {
    if (!queue || !language) return undefined;
    const how = await queue(language, words.map((w) => ({ entry: w.text, meaning: w.english })));
    // The cram as it is now: a word asked for while another save was in flight isn't lost.
    const now = cramsNow().find((x) => x.id === cram.id);
    if (how && now) await saveCram(repo, words.reduce((next, w) => withRequest(next, { text: w.text, english: w.english }), now));
    return how;
  };

  const name = language ? LANGUAGES[language].name : undefined;
  return (
    <Screen
      title="Add"
      largeTitle={false}
      toolbar={(
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button accessibilityLabel="Done adding" onPress={() => leaveScreen(router, PRACTICE_PATH)}>Done</Stack.Toolbar.Button>
        </Stack.Toolbar>
      )}
    >
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl + bottomPadding }}
        ListHeaderComponent={(
          <View style={{ gap: space.m, paddingVertical: space.m }}>
            <Field
              label={`${inCram.length === 1 ? '1 word' : `${inCram.length} words`} in ${cram.name}`}
              value={query}
              onChangeText={setQuery}
              placeholder={name ? 'A word, a meaning, or something to say' : 'Search by word or meaning'}
              autoFocus={!initial}
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
              returnKeyType="search"
            />
            <Help>{name ? `Type in ${name} or English. Searches your ${name} words by word and meaning, or a tag.` : 'Searches every word by word and meaning, or a tag.'}</Help>
            {typed && !exact && language && findWords && queue ? (
              <CramAsk key={typed} text={typed} language={language} findWords={(t) => findWords(language, t)} ask={ask} queued={queued} approve={approve ? async (note) => { const saved = await approve(note); if (saved) collection.reload(); return saved; } : undefined} />
            ) : null}
            {tagMatch && tagged.length ? (
              <Group>
                <NavRow first icon={{ name: 'tag', color: c.accent }} label={`Add all ${tagged.length} tagged ${tagMatch}`} onPress={() => void addTagged()} />
              </Group>
            ) : null}
            {problem ? <Text style={{ ...type.subhead, color: c.danger }}>{problem}</Text> : null}
            {rows.length ? <Text style={{ ...type.subhead, color: c.textSecondary }}>{typed ? 'In your deck' : 'Added most recently'}</Text> : null}
          </View>
        )}
        data={rows}
        keyExtractor={(n) => n.id}
        renderItem={({ item, index }) => {
          const on = checked(item);
          const meaning = meaningOf(item);
          return (
            <View style={{ backgroundColor: c.surface, borderTopLeftRadius: index === 0 ? radius.l : 0, borderTopRightRadius: index === 0 ? radius.l : 0, borderBottomLeftRadius: index === rows.length - 1 ? radius.l : 0, borderBottomRightRadius: index === rows.length - 1 ? radius.l : 0, overflow: 'hidden' }}>
              <CheckRow
                first={index === 0}
                label={headword(item) || 'Untitled'}
                detail={[meaning, item.deck.split('::').pop()].filter(Boolean).join(' · ')}
                checked={on}
                onPress={() => void toggle(item)}
                trailing={noteHasTag(item, tag) !== on ? <Text style={{ ...type.caption, color: c.textSecondary }}>Saving</Text> : undefined}
              />
            </View>
          );
        }}
        ListEmptyComponent={typed ? <Help>{`None of your ${name ?? ''} words match.`.replace('  ', ' ')}</Help> : undefined}
        ListFooterComponent={rows.length === SHOWN ? <Text style={{ ...type.footnote, color: c.textSecondary, paddingTop: space.m }}>{typed ? `Showing the best ${SHOWN} matches.` : `Showing the ${SHOWN} most recently added. Search to find others.`}</Text> : undefined}
      />
    </Screen>
  );
}
