import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import type { AudioLesson } from '../reader/api';
import { useApp } from '../ui/AppContext';
import { ReadLesson } from '../ui/reader/ReadLesson';

/** One audio lesson, playing. `lesson` is the lesson as the list showed it. */
export default function ReadLessonRoute() {
  const router = useRouter();
  const { reader } = useApp();
  const { lesson: raw } = useLocalSearchParams<{ lesson?: string }>();
  const lesson = useMemo(() => {
    try { return raw ? (JSON.parse(raw) as AudioLesson) : null; } catch { return null; }
  }, [raw]);
  if (!reader.api || !lesson) return <Redirect href="/lessons" />;
  return <ReadLesson api={reader.api} lesson={lesson} onDeleted={() => router.back()} />;
}
