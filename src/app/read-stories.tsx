import { Redirect, useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { ReadStories } from '../ui/reader/ReadStories';

/** Every story in the language being read, from the home's Your stories row. */
export default function ReadStoriesRoute() {
  const router = useRouter();
  const { reader } = useApp();
  if (!reader.api) return <Redirect href="/read-settings" />;
  return (
    <ReadStories
      api={reader.api}
      onStory={(story) => router.push({ pathname: '/read-story', params: { story: String(story) } })}
      onNew={() => router.push({ pathname: '/read-write', params: { kind: 'series' } })}
    />
  );
}
