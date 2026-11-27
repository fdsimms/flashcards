import { Redirect, useLocalSearchParams } from 'expo-router';
import React from 'react';
import type { Language } from '../reader/api';
import { LANGUAGES } from '../reader/languages';
import { useApp } from '../ui/AppContext';
import { JournalMistakes } from '../ui/journal/JournalMistakes';

/** What you keep getting wrong, from the Journal tool's All. */
export default function JournalMistakesRoute() {
  const { reader } = useApp();
  const { language } = useLocalSearchParams<{ language: string }>();
  if (!reader.api || !(language in LANGUAGES)) return <Redirect href="/read-settings" />;
  const code = language as Language;
  return <JournalMistakes api={reader.api} language={code} />;
}
