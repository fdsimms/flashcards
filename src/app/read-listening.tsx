import { useRouter } from 'expo-router';
import React from 'react';
import { Redirect } from 'expo-router';
import { useApp } from '../ui/AppContext';
import { ReadListening } from '../ui/reader/ReadListening';

/** Read & Listen's voices, listening and reading options, once it's turned on. */
export default function ReadListeningRoute() {
  const router = useRouter();
  const { reader } = useApp();
  if (!reader.api) return <Redirect href="/read-settings" />;
  return (
    <ReadListening
      voices={reader.settings?.voices}
      onVoices={(language) => router.push({ pathname: '/read-voices', params: { language } })}
    />
  );
}
