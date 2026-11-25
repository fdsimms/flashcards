import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { ReadGrammarLesson } from '../ui/reader/ReadGrammarLesson';
import { useGrammarGlossing } from '../ui/useGrammarGlossing';
import { useWordAudio } from '../ui/useWordAudio';

/** The questions a lesson's Practice button opens: a short round on the point. */
const LESSON_QUESTIONS = 5;

/** A grammar point's lesson, for the point named by the `id` parameter (ReadGrammarLesson). */
export default function ReadGrammarLessonRoute() {
  const router = useRouter();
  const { repo, reader } = useApp();
  const { id } = useLocalSearchParams<{ id: string }>();
  const playWord = useWordAudio(repo);
  const glossing = useGrammarGlossing();
  if (!reader.api) return <Redirect href="/read-settings" />;
  return (
    <ReadGrammarLesson
      api={reader.api}
      id={id}
      glossing={glossing}
      onSay={(line, language) => playWord(line, language)}
      onPractice={(point) => router.push({ pathname: '/tool', params: { id: 'grammar', points: JSON.stringify([point]), count: String(LESSON_QUESTIONS) } })}
    />
  );
}
