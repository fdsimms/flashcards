import { Redirect, useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { ReadStories } from '../ui/reader/ReadStories';

/** Every story in the language being read, from the shelf's Library. */
export default function ReadStoriesRoute() {
  const router = useRouter();
  const { reader } = useApp();
  if (!reader.api) return <Redirect href="/read-settings" />;
  return (
    <ReadStories
      api={reader.api}
      onOpen={(textId) => router.push({ pathname: '/reader', params: { source: JSON.stringify({ kind: 'shelf', textId, order: [textId] }) } })}
      onEpisodes={(story) => router.push({ pathname: '/read-past', params: { story: String(story) } })}
    />
  );
}
