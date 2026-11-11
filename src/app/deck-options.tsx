import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { DeckOptions } from '../ui/DeckOptions';

export default function DeckOptionsRoute() {
  const { repo } = useApp();
  const { deck } = useLocalSearchParams<{ deck: string }>();
  return <DeckOptions repo={repo} deck={deck} />;
}
