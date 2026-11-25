import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { DeckCounts } from '../ui/DeckCounts';

export default function DeckCountsRoute() {
  const { decks } = useApp();
  const { deck } = useLocalSearchParams<{ deck: string }>();
  return <DeckCounts row={decks.find((r) => r.deck === deck)} />;
}
