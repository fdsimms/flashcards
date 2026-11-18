import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { ReadWrite } from '../ui/reader/ReadWrite';

/** Having a series, dialogue or story written, from the home's + button, as a sheet. `kind` skips the choice. */
export default function ReadWriteRoute() {
  const router = useRouter();
  const { reader } = useApp();
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  if (!reader.api) return <Redirect href="/read-settings" />;
  return (
    <ReadWrite
      api={reader.api}
      language={reader.settings?.language}
      kind={kind === 'series' || kind === 'dialogue' || kind === 'story' ? kind : undefined}
      onDone={() => router.back()}
    />
  );
}
