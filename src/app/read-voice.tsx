import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import type { Language } from '../reader/api';
import { isVoiceSlot } from '../reader/voiceSlots';
import { useApp } from '../ui/AppContext';
import { ReadVoicePick } from '../ui/ReadVoicePick';

/** One voice slot (`slot`: male, male2, female or female2) of a Read & Listen language (`language`). */
export default function ReadVoiceRoute() {
  const router = useRouter();
  const { reader } = useApp();
  const { language, slot } = useLocalSearchParams<{ language: Language; slot: string }>();
  // Read & Listen was turned off (or its passphrase changed): back to its settings.
  useEffect(() => { if (!reader.api) router.back(); }, [reader.api, router]);
  if (!reader.api || !isVoiceSlot(slot)) return null;
  return <ReadVoicePick api={reader.api} language={language} slot={slot} selected={reader.settings?.voices?.[language]?.[slot]} onSettings={reader.setSettings} />;
}
