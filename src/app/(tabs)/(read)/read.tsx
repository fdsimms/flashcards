import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import type { Language } from '../../../reader/api';
import { useApp } from '../../../ui/AppContext';
import { ReadShelf } from '../../../ui/ReadShelf';
import { useWordAudio } from '../../../ui/useWordAudio';

/**
 * Read & Listen's home: the shelf of the language last read. Sends you to its settings when it
 * isn't signed in. Its `practice` parameter (JSON: a language and words) comes from Review's "Read a
 * text with these words": the shelf offers a text written to practice them.
 */
export default function ReadRoute() {
  const router = useRouter();
  const { reader, repo } = useApp();
  const playWord = useWordAudio(repo);
  const { practice: raw } = useLocalSearchParams<{ practice?: string }>();
  const practice = useMemo(() => {
    try { return raw ? (JSON.parse(raw) as { language: Language; words: string[] }) : undefined; } catch { return undefined; }
  }, [raw]);
  if (!reader.api) return <Redirect href="/read-settings" />;
  const api = reader.api;
  return (
    <ReadShelf
      api={api}
      practice={practice ? { language: practice.language, count: practice.words.length, onCancel: () => router.setParams({ practice: '' }) } : undefined}
      onPlayWord={playWord}
      onOpen={(open) => router.push({ pathname: '/reader', params: { source: JSON.stringify({ kind: 'shelf', ...open }) } })}
      onPractice={(topic) => {
        // Only this text practices them. Cleared before the push, since setParams changes whichever
        // screen is in front.
        const words = practice?.words;
        router.setParams({ practice: '' });
        router.push({ pathname: '/reader', params: { source: JSON.stringify({ kind: 'topic', topic, words }) } });
      }}
      onLanguagePage={() => router.push('/read-language')}
      onPast={() => router.push('/read-past')}
      onEpisodes={(story) => router.push({ pathname: '/read-past', params: { story: String(story) } })}
      onWords={() => router.push('/read-words')}
      onLanguage={() => { api.settings().then(reader.setSettings, () => undefined); }}
      onReview={(deck) => router.push({ pathname: '/review', params: { deck } })}
    />
  );
}
