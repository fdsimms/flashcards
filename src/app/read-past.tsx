import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { ReadPastTexts } from '../ui/ReadPastTexts';

export default function ReadPastRoute() {
  const router = useRouter();
  const { reader: { api: readerApi } } = useApp();
  // `story`: one story's id, to list its episodes (Read from the start).
  const { story } = useLocalSearchParams<{ story?: string }>();
  if (!readerApi) return <Redirect href="/read-settings" />;
  return (
    <ReadPastTexts
      api={readerApi}
      story={story ? Number(story) : undefined}
      onOpen={(text) => router.push({ pathname: '/reader', params: { source: JSON.stringify({ kind: 'past', text }) } })}
    />
  );
}
