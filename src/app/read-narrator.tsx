import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { ReadNarratorPick } from '../ui/reader/ReadNarratorPick';
import { useApp } from '../ui/AppContext';
import { useNarrator } from '../ui/useNarrator';
import { leaveScreen } from '../ui/leaveScreen';
import { DECKS_PATH } from '../ui/tabPaths';

/** The English voice that narrates audio lessons, from the lessons screen. */
export default function ReadNarratorRoute() {
  const router = useRouter();
  const { reader } = useApp();
  const narrator = useNarrator();
  // Read & Listen was turned off (or its passphrase changed): back out.
  useEffect(() => { if (!reader.api) leaveScreen(router, DECKS_PATH); }, [reader.api, router]);
  if (!reader.api) return null;
  return <ReadNarratorPick api={reader.api} current={narrator} serverDefault={reader.settings?.voices?.en?.male} />;
}
