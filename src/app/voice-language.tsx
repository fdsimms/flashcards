import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { VoiceLanguage } from '../ui/Voices';

/** One language's voice and speed (`lang` is its code, e.g. th). */
export default function VoiceLanguageRoute() {
  const { repo } = useApp();
  const { lang } = useLocalSearchParams<{ lang: string }>();
  return <VoiceLanguage repo={repo} languageKey={lang} />;
}
