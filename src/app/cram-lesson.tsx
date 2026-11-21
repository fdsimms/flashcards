import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { CramLesson } from '../ui/cram/CramLesson';
import { leaveScreen } from '../ui/leaveScreen';
import { PRACTICE_PATH } from '../ui/tabPaths';

/** Lesson mode for the cram named by `id`: its questions and words to check off, and new words to jot down. */
export default function CramLessonRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CramLesson repo={useApp().repo} id={id} onDone={() => leaveScreen(router, PRACTICE_PATH)} />;
}
