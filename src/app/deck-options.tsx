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
  return <DeckOptions repo={repo} deck={deck} onCustomStudy={() => router.push({ pathname: '/custom-study', params: { deck } })} onSkillCards={() => router.push({ pathname: '/skill-cards', params: { deck } })} onBrowse={() => router.push({ pathname: '/browse', params: { deck } })} onAnkiOptions={() => router.push({ pathname: '/deck-preset', params: { deck } })} onNativeRecordings={() => router.push({ pathname: '/deck-native', params: { deck } })} recorder={recorder} />;
}
