import { Redirect } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { ReadLevel } from '../ui/reader/ReadLevel';

/** The current Read & Listen language's level, from the card on its settings page. */
export default function ReadLevelRoute() {
  const { reader } = useApp();
  if (!reader.api) return <Redirect href="/read-settings" />;
  return <ReadLevel api={reader.api} language={reader.settings?.language ?? 'th'} />;
}
