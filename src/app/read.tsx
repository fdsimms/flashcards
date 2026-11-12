import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import type { Language } from '../reader/api';
import { useApp } from '../ui/AppContext';
import { ReadTopics } from '../ui/ReadTopics';

/**
 * Read & Listen's home: its topics. Sends you to its settings when it isn't signed in. Its
 * `practice` parameter (JSON: a language and words) comes from Review's "Read a text with these
 * words": the topic opened next is written to practice them.
 */
export default function ReadRoute() {
  const router = useRouter();
  const { reader, decks } = useApp();
  const { practice: raw } = useLocalSearchParams<{ practice?: string }>();
  const practice = useMemo(() => {
    try { return raw ? (JSON.parse(raw) as { language: Language; words: string[] }) : undefined; } catch { return undefined; }
  }, [raw]);
  if (!reader.api) return <Redirect href="/read-settings" />;
  return (
    <ReadTopics
      api={reader.api}
      deckNames={decks.map((d) => d.deck)}
      onSettings={reader.setSettings}
      practice={practice ? { language: practice.language, count: practice.words.length, onCancel: () => router.setParams({ practice: '' }) } : undefined}
      onOpen={(topic) => {
        // Only the topic opened next practices them; coming back from it, topics are as usual. Cleared
        // before the push, since setParams changes whichever screen is in front.
        if (practice) router.setParams({ practice: '' });
        router.push({ pathname: '/reader', params: { source: JSON.stringify({ kind: 'topic', topic, words: practice?.words }) } });
      }}
      onPast={() => router.push('/read-past')}
      onWords={() => router.push('/read-words')}
      onGrammar={() => router.push('/read-grammar')}
    />
  );
}
