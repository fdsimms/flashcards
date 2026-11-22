import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { CramStory } from '../ui/cram/CramStory';

/** Editing the story of the cram `id`'s talking point `title` (its page's ⋯ menu). */
export default function CramStoryRoute() {
  const router = useRouter();
  const { id, title } = useLocalSearchParams<{ id: string; title: string }>();
  const { reader, repo } = useApp();
  if (!reader.api) return <Redirect href="/read-settings" />;
  return <CramStory repo={repo} api={reader.api} id={id} title={title} onDone={() => router.back()} />;
}
