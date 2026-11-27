import { Redirect, useLocalSearchParams } from 'expo-router';
import React from 'react';
import type { Language } from '../reader/api';
import { LANGUAGES } from '../reader/languages';
import { useApp } from '../ui/AppContext';
import { SoundGuideScreen } from '../ui/SoundGuideScreen';
import { usePhoneSpeech } from '../ui/usePhoneSpeech';

/** How a language sounds, from its path on Today (src/core/fromZero.ts). */
export default function SoundsRoute() {
  const { repo } = useApp();
  const speech = usePhoneSpeech(repo);
  const { language } = useLocalSearchParams<{ language: string }>();
  if (!language || !(language in LANGUAGES)) return <Redirect href="/" />;
  const code = language as Language;
  return <SoundGuideScreen language={code} onSay={(word) => void speech.sayWord(word, LANGUAGES[code].speech)} />;
}
