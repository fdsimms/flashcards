import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import type { Language } from '../reader/api';
import { castFor } from '../reader/storyCast';
import { useApp } from '../ui/AppContext';
import { ReadCast } from '../ui/reader/ReadCast';
import { leaveScreen } from '../ui/leaveScreen';
import { DECKS_PATH } from '../ui/tabPaths';

/** One language's story characters in Read & Listen (`language`: its code, th, es, de...). */
export default function ReadCastRoute() {
  const router = useRouter();
  const { reader } = useApp();
  const { language } = useLocalSearchParams<{ language: Language }>();
  // Read & Listen was turned off (or its passphrase changed): back to its settings.
  useEffect(() => { if (!reader.api) leaveScreen(router, DECKS_PATH); }, [reader.api, router]);
  const cast = castFor(reader.settings, language);
  const narrator = reader.settings?.voices?.[language]?.male;
  if (!reader.api || !cast || !narrator) return null;
  return (
    <ReadCast
      api={reader.api}
      language={language}
      cast={cast}
      narrator={narrator}
      onSettings={reader.setSettings}
      onPick={(kind) => router.push({ pathname: '/read-cast-kind', params: { language, kind } })}
    />
  );
}
