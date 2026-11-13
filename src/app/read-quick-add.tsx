import { Redirect, useRouter } from 'expo-router';
import React from 'react';
import { quickAddDecks } from '../reader/noteQueue';
import { useApp } from '../ui/AppContext';
import { Loading, Screen } from '../ui/kit';
import { ReadQuickAdd } from '../ui/ReadQuickAdd';
import { useNoteQueue } from '../ui/useNoteQueue';

/** Quick add, from the deck list: words for Claude to fill in on Read & Listen's server. */
export default function ReadQuickAddRoute() {
  const router = useRouter();
  const { reader, decks } = useApp();
  const queue = useNoteQueue(reader.api);
  if (!reader.api) return <Redirect href="/read-settings" />;
  // Read & Listen's settings are still loading.
  if (!reader.settings) return <Screen title="Quick add" largeTitle={false}><Loading /></Screen>;
  // The same choice as the deck list's Quick add button, which is hidden when it's empty.
  const options = quickAddDecks(reader.settings.decks, decks.map((d) => d.deck), reader.settings.language);
  const initial = options[0]?.deck;
  if (!initial) return <Redirect href="/read-settings" />;
  return (
    <ReadQuickAdd
      decks={options}
      initial={initial}
      onAdd={queue.add}
      onDone={() => router.back()}
    />
  );
}
