import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { DeckPreset } from '../ui/DeckPreset';

export default function DeckPresetRoute() {
  const { repo } = useApp();
  const { deck } = useLocalSearchParams<{ deck: string }>();
  return <DeckPreset repo={repo} deck={deck} />;
}
