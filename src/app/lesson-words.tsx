import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { useApp } from '../ui/AppContext';
import { LessonWordPicker } from '../ui/reader/LessonWordPicker';

/** Choose words for the next audio lesson from the decks, in the language Read & Listen reads. */
export default function LessonWordsRoute() {
  const router = useRouter();
  const { repo, reader } = useApp();
  const language = reader.settings?.language;
  // Read & Listen was turned off while this was open: back out.
  useEffect(() => { if (!reader.api || !language) router.back(); }, [reader.api, language, router]);
  if (!reader.api || !language) return null;
  return <LessonWordPicker repo={repo} language={language} />;
}
