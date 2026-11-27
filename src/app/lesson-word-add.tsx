import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { loadParticle } from '../reader/lessonStorage';
import { useApp } from '../ui/AppContext';
import { LessonWordAdd } from '../ui/reader/LessonWordAdd';
import { leaveScreen } from '../ui/leaveScreen';
import { DECKS_PATH } from '../ui/tabPaths';
import { spokenLanguage } from '../reader/languages';

/** Type a word for the next audio lesson, in the language Read & Listen reads. */
export default function LessonWordAddRoute() {
  const router = useRouter();
  const { reader } = useApp();
  const language = spokenLanguage(reader.settings?.language);
  useEffect(() => { if (!reader.api || !language) leaveScreen(router, DECKS_PATH); }, [reader.api, language, router]);
  if (!reader.api || !language) return null;
  const api = reader.api;
  return <LessonWordAdd language={language} findWords={async (text) => api.lessonWords(language, text, await loadParticle())} />;
}
