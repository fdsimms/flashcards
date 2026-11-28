import { Redirect, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { DeckNative } from '../ui/DeckNative';
import { useRecorder } from '../ui/useRecorder';

/** Deck options' Native recordings: the deck's words given native speakers' recordings from Wikimedia Commons. */
export default function DeckNativeRoute() {
  const { reader } = useApp();
  const recorder = useRecorder();
  const { deck } = useLocalSearchParams<{ deck: string }>();
  if (!reader.api || !recorder) return <Redirect href="/read-settings" />;
  return <DeckNative deck={deck} api={reader.api} recorder={recorder} />;
}
