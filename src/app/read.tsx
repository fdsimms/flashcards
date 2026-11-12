import { Redirect, useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { ReadTopics } from '../ui/ReadTopics';

/** Read & Listen's home: its topics. Sends you to its settings when it isn't signed in. */
export default function ReadRoute() {
  const router = useRouter();
  const { readerApi } = useApp();
  if (!readerApi) return <Redirect href="/read-settings" />;
  return (
    <ReadTopics
      api={readerApi}
      onOpen={(topic) => router.push({ pathname: '/reader', params: { source: JSON.stringify({ kind: 'topic', topic }) } })}
      onPast={() => router.push('/read-past')}
      onWords={() => router.push('/read-words')}
      onGrammar={() => router.push('/read-grammar')}
    />
  );
}
