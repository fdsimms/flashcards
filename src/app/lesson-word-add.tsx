import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { useApp } from '../ui/AppContext';
import { LessonWordAdd } from '../ui/reader/LessonWordAdd';

/** Type a phrase for the next audio lesson, in the language Read & Listen reads. */
export default function LessonWordAddRoute() {
  const router = useRouter();
  const { reader } = useApp();
  const language = reader.settings?.language;
  useEffect(() => { if (!reader.api || !language) router.back(); }, [reader.api, language, router]);
  if (!reader.api || !language) return null;
  return <LessonWordAdd language={language} />;
}
