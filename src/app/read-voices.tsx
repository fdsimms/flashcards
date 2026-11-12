import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import type { Language } from '../reader/api';
import { useApp } from '../ui/AppContext';
import { ReadVoices } from '../ui/ReadVoices';

/** One language's speaker voices in Read & Listen (`language`: th or es). */
export default function ReadVoicesRoute() {
  const router = useRouter();
  const { reader } = useApp();
  const { language } = useLocalSearchParams<{ language: Language }>();
  // Read & Listen was turned off (or its passphrase changed): back to its settings.
  useEffect(() => { if (!reader.api) router.back(); }, [reader.api, router]);
  if (!reader.api) return null;
  return <ReadVoices api={reader.api} language={language} onSettings={reader.setSettings} />;
}
