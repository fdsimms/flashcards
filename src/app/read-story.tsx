import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { ReadStory } from '../ui/reader/ReadStory';
import { useWordAudio } from '../ui/useWordAudio';

/** One story's page, from its cover or the home's banner. `story`: its id. */
export default function ReadStoryRoute() {
  const router = useRouter();
  const { reader, repo } = useApp();
  const playWord = useWordAudio(repo);
  const { story } = useLocalSearchParams<{ story?: string }>();
  if (!reader.api) return <Redirect href="/read-settings" />;
  if (!story) return <Redirect href="/read" />;
  return (
    <ReadStory
      api={reader.api}
      storyId={Number(story)}
      language={reader.settings?.language ?? 'fr'}
      onPlayWord={playWord}
      onOpen={(textId) => router.push({ pathname: '/reader', params: { source: JSON.stringify({ kind: 'shelf', textId, order: [textId] }) } })}
      onReadAgain={(text) => router.push({ pathname: '/reader', params: { source: JSON.stringify({ kind: 'past', text }) } })}
    />
  );
}
