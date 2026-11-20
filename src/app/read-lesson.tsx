import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import type { AudioLesson } from '../reader/api';
import { useApp } from '../ui/AppContext';
import { ReadLesson } from '../ui/reader/ReadLesson';
import { useAddMinedWord } from '../ui/useAddMinedWord';
import { useWordAudio } from '../ui/useWordAudio';
import { leaveScreen } from '../ui/leaveScreen';
import { READ_PATH } from '../ui/tabPaths';

/** One audio lesson, playing. `lesson` is the lesson as the list showed it. */
export default function ReadLessonRoute() {
  const router = useRouter();
  const { repo, reader } = useApp();
  // A tapped word in a phrase: played, or added to its language's deck as the reader's words are.
  const playWord = useWordAudio(repo);
  const addWord = useAddMinedWord();
  const { lesson: raw } = useLocalSearchParams<{ lesson?: string }>();
  const lesson = useMemo(() => {
    try { return raw ? (JSON.parse(raw) as AudioLesson) : null; } catch { return null; }
  }, [raw]);
  if (!reader.api || !lesson) return <Redirect href="/lessons" />;
  return (
    <ReadLesson api={reader.api} lesson={lesson} onDeleted={() => leaveScreen(router, READ_PATH)}
      onAddToDeck={reader.settings?.decks?.[lesson.language] ? () => router.push({ pathname: '/lesson-add', params: { lesson: raw! } }) : undefined}
      onPlayWord={playWord}
      onAddWord={async (word, meaning, lang, pronunciation) => {
        const wordDeck = reader.settings?.decks?.[lang];
        return wordDeck ? addWord({ word, meaning, deck: wordDeck, language: lang, pronunciation }) : false;
      }}
    />
  );
}
