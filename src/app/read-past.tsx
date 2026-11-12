import { Redirect, useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { ReadPastTexts } from '../ui/ReadPastTexts';

export default function ReadPastRoute() {
  const router = useRouter();
  const { readerApi } = useApp();
  if (!readerApi) return <Redirect href="/read-settings" />;
  return (
    <ReadPastTexts
      api={readerApi}
      onOpen={(text) => router.push({ pathname: '/reader', params: { source: JSON.stringify({ kind: 'past', text }) } })}
    />
  );
}
