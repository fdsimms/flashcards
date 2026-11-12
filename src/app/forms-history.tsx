import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { FormsHistory } from '../ui/FormsHistory';

/** What forms practice has shown for the deck named by the `deck` parameter. */
export default function FormsHistoryRoute() {
  const { repo } = useApp();
  const { deck } = useLocalSearchParams<{ deck: string }>();
  return <FormsHistory repo={repo} deck={deck} />;
}
