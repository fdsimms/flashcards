import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { VoiceLanguage } from '../ui/Voices';

/** One language's voices: Azure's for recordings, the iPhone's and its speed (`lang` is its code, e.g. th). */
export default function VoiceLanguageRoute() {
  const { repo, reader } = useApp();
  const { lang } = useLocalSearchParams<{ lang: string }>();
  return <VoiceLanguage repo={repo} api={reader.api} languageKey={lang} />;
}
