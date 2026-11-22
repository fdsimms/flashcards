import { Stack, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import type { NoteStore } from '../../anki/noteService';
import { LESSON_MAX_WORDS } from '../../core/cram';
import { failureText } from '../../core/failure';
import { withThaiLineHeight } from '../../core/script';
import { hasLessonWord, pickerWords, PICKER_ROWS, WORD_FILTERS, type WordFilter } from '../../core/lessonWords';
import type { Language } from '../../reader/api';
import { LANGUAGES } from '../../reader/languages';
import { haptic } from '../haptics';
import { Divider, Field, Icon, Loading, Screen, Segments } from '../kit';
import { MIN_TAP, readable, space, type, useTheme } from '../theme';
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
            {problem ? <Text style={{ ...type.subhead, color: c.danger }}>{problem}</Text> : null}
            <Segments<WordFilter> options={WORD_FILTERS} value={filter} onChange={setFilter} />
            <Text style={{ ...type.footnote, color: c.textSecondary }}>{`${words.length} of ${LESSON_MAX_WORDS} chosen`}</Text>
          </View>
        )}
        data={rows}
        keyExtractor={(w) => w.noteId ?? w.text}
        renderItem={({ item, index }) => {
          const on = hasLessonWord(words, item.text);
          return (
            <Pressable
              onPress={() => toggle(item)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${item.text}, ${item.english}`}
              style={({ pressed }) => ({
                minHeight: MIN_TAP + space.m, flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.s, paddingHorizontal: space.m,
                backgroundColor: pressed ? c.fill : c.surface,
              })}
            >
              {index === 0 ? null : <Divider inset={space.m} />}
              <Icon name={on ? 'checkmark.circle.fill' : 'circle'} size={22} color={on ? c.accent : c.textTertiary} weight="regular" />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ ...withThaiLineHeight(type.body, item.text), color: c.text }}>{item.text}</Text>
                <Text numberOfLines={1} style={{ ...type.footnote, color: c.textSecondary }}>{item.english}</Text>
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={<Text style={{ ...type.footnote, color: c.textSecondary }}>{empty}</Text>}
        ListFooterComponent={rows.length === PICKER_ROWS ? <Text style={{ ...type.footnote, color: c.textSecondary, paddingTop: space.m }}>{`Showing the first ${PICKER_ROWS}. Search to find others.`}</Text> : undefined}
      />
    </Screen>
  );
}
