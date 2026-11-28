import { Redirect, useLocalSearchParams, useNavigation } from 'expo-router';
import React from 'react';
import type { Language } from '../reader/api';
import { LANGUAGES } from '../reader/languages';
import { IPA_GUIDES } from '../tools/ipaGuide';
import { useApp } from '../ui/AppContext';
import { SHEET_ROUTES } from '../ui/homeButton';
import { IpaSheet } from '../ui/IpaSheet';
import { usePhoneSpeech } from '../ui/usePhoneSpeech';

/** A word's IPA explained, from the pill on a card or in Look up (IpaPill.tsx), or a word popup's How it's said. */
export default function IpaRoute() {
  const { repo } = useApp();
  const speech = usePhoneSpeech(repo);
  const { ipa, language } = useLocalSearchParams<{ ipa: string; language: string }>();
  // Opened over another sheet (Look up), it leaves out All sounds: that closes this sheet and pushes a screen, which belongs on a screen, not a sheet.
  const routes = useNavigation().getState()?.routes ?? [];
  const overSheet = SHEET_ROUTES.includes(routes[routes.length - 2]?.name ?? '');
  if (!ipa || !language || !(language in LANGUAGES) || !IPA_GUIDES[language as Language]) return <Redirect href="/" />;
  const code = language as Language;
  return <IpaSheet ipa={ipa} language={code} allSounds={!overSheet} onSay={(word) => void speech.sayWord(word, LANGUAGES[code].speech)} />;
}
