import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { DeckOptions } from '../ui/DeckOptions';
import { useRecorder } from '../ui/useRecorder';

export default function DeckOptionsRoute() {
  const router = useRouter();
  const { repo } = useApp();
  const recorder = useRecorder();
  const { deck } = useLocalSearchParams<{ deck: string }>();
  return <DeckOptions repo={repo} deck={deck} onCustomStudy={() => router.push({ pathname: '/custom-study', params: { deck } })} recorder={recorder} />;
}
