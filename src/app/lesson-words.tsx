import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { useApp } from '../ui/AppContext';
import { LessonWordPicker } from '../ui/reader/LessonWordPicker';
import { leaveScreen } from '../ui/leaveScreen';
import { DECKS_PATH } from '../ui/tabPaths';
import { spokenLanguage } from '../reader/languages';

/** Choose words for the next audio lesson from the decks, in the language Read & Listen reads. */
export default function LessonWordsRoute() {
  const router = useRouter();
  const { repo, reader } = useApp();
  const language = spokenLanguage(reader.settings?.language);
  // Read & Listen was turned off while this was open: back out.
  useEffect(() => { if (!reader.api || !language) leaveScreen(router, DECKS_PATH); }, [reader.api, language, router]);
  if (!reader.api || !language) return null;
  return <LessonWordPicker repo={repo} language={language} />;
}
