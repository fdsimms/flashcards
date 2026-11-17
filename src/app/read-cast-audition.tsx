import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import type { Language } from '../reader/api';
import { castFor, isCastKind } from '../reader/storyCast';
import { useApp } from '../ui/AppContext';
import { ReadCastAudition } from '../ui/reader/ReadCastAudition';

/** The voices of a language played side by side for one kind of story character (`kind`: man, woman, boy, girl, elder_man or elder_woman). */
export default function ReadCastAuditionRoute() {
  const router = useRouter();
  const { reader } = useApp();
  const { language, kind } = useLocalSearchParams<{ language: Language; kind: string }>();
  // Read & Listen was turned off (or its passphrase changed): back to its settings.
  useEffect(() => { if (!reader.api) router.back(); }, [reader.api, router]);
  const cast = castFor(reader.settings, language);
  if (!reader.api || !cast || !isCastKind(kind)) return null;
  return <ReadCastAudition api={reader.api} language={language} kind={kind} current={cast[kind]} onSettings={reader.setSettings} onSaved={() => router.back()} />;
}
