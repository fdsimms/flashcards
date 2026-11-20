import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import type { Language } from '../reader/api';
import { castFor, isCastKind } from '../reader/storyCast';
import { useApp } from '../ui/AppContext';
import { ReadCastKind } from '../ui/reader/ReadCastKind';
import { leaveScreen } from '../ui/leaveScreen';
import { DECKS_PATH } from '../ui/tabPaths';

/** One kind of story character (`kind`: man, woman, boy, girl, elder_man or elder_woman) of a Read & Listen language (`language`). */
export default function ReadCastKindRoute() {
  const router = useRouter();
  const { reader } = useApp();
  const { language, kind } = useLocalSearchParams<{ language: Language; kind: string }>();
  // Read & Listen was turned off (or its passphrase changed): back to its settings.
  useEffect(() => { if (!reader.api) leaveScreen(router, DECKS_PATH); }, [reader.api, router]);
  const cast = castFor(reader.settings, language);
  if (!reader.api || !cast || !isCastKind(kind)) return null;
  return <ReadCastKind api={reader.api} language={language} kind={kind} current={cast[kind]} onSettings={reader.setSettings} onAudition={() => router.push({ pathname: '/read-cast-audition', params: { language, kind } })} />;
}
