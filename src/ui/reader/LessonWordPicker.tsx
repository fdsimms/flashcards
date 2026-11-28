import { Stack, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import type { NoteStore } from '../../anki/noteService';
import { LESSON_MAX_WORDS } from '../../core/cram';
import { failureText } from '../../core/failure';
import { hasLessonWord, pickerWords, PICKER_ROWS, WORD_FILTERS, type WordFilter } from '../../core/lessonWords';
import type { Language } from '../../reader/api';
import { LANGUAGES } from '../../reader/languages';
import { haptic } from '../haptics';
import { CheckboxRow, ErrorNote, Field, Loading, Screen, Segments } from '../kit';
import { readable, space, type, useTheme } from '../theme';
import { useCollection, useCramClock } from '../useCrams';
import { useLessonWords } from './useLessonWords';
import { leaveScreen } from '../leaveScreen';
import { LESSONS_PATH } from '../tabPaths';

/**
 * Choose words for an audio lesson from the decks: the language's notes, most recently added first
 * or only those due today or lapsed, searched by word or meaning. A tap checks a word or takes it
 * off the lesson's draft (useLessonWords); one that can't be added says why under the search.
 */
export function LessonWordPicker({ repo, language }: { repo: NoteStore; language: Language }) {
  const c = useTheme();
  const router = useRouter();
  const collection = useCollection(repo);
  const { now, dayStartsAtHour } = useCramClock(repo);
  const { words, add, remove } = useLessonWords(language);
  const [filter, setFilter] = useState<WordFilter>('recent');
  const [query, setQuery] = useState('');
  const [problem, setProblem] = useState<string>();

  const rows = useMemo(
    () => pickerWords(collection.notes, collection.cards, language, filter, query, now, dayStartsAtHour),
    [collection.notes, collection.cards, language, filter, query, now, dayStartsAtHour],
  );

  if (!collection.loaded) return <Screen title="Choose words" largeTitle={false}><Loading /></Screen>;
  const toggle = (word: (typeof rows)[number]) => {
    haptic.select();
    setProblem(undefined);
    try {
      if (hasLessonWord(words, word.text)) remove(word.text);
      else add(word);
    } catch (e) {
      setProblem(failureText(e, { next: 'Try again.' }));
    }
  };
  const empty = filter === 'due' ? 'No words in this language are due today.' : filter === 'lapsed' ? 'No words in this language have lapsed.' : `No ${LANGUAGES[language].name} words match.`;

  return (
    <Screen title="Choose words" largeTitle={false}>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button accessibilityLabel="Done choosing words" onPress={() => leaveScreen(router, LESSONS_PATH)}>Done</Stack.Toolbar.Button>
      </Stack.Toolbar>
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl }}
        ListHeaderComponent={(
          <View style={{ gap: space.s, paddingVertical: space.m }}>
            <Field label={`${LANGUAGES[language].name} words`} value={query} onChangeText={setQuery} placeholder="Search by word or meaning" autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" />
            {problem ? <ErrorNote message={problem} /> : null}
            <Segments<WordFilter> options={WORD_FILTERS} value={filter} onChange={setFilter} />
            <Text style={{ ...type.footnote, color: c.textSecondary }}>{`${words.length} of ${LESSON_MAX_WORDS} chosen`}</Text>
          </View>
        )}
        data={rows}
        keyExtractor={(w) => w.noteId ?? w.text}
        renderItem={({ item, index }) => {
          const on = hasLessonWord(words, item.text);
          return (
            <CheckboxRow first={index === 0} checked={on} onPress={() => toggle(item)} label={item.text} detail={item.english} />
          );
        }}
        ListEmptyComponent={<Text style={{ ...type.footnote, color: c.textSecondary }}>{empty}</Text>}
        ListFooterComponent={rows.length === PICKER_ROWS ? <Text style={{ ...type.footnote, color: c.textSecondary, paddingTop: space.m }}>{`Showing the first ${PICKER_ROWS}. Search to find others.`}</Text> : undefined}
      />
    </Screen>
  );
}
