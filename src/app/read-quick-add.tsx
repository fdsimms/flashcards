import { Redirect, useRouter } from 'expo-router';
import React from 'react';
import { type Language } from '../reader/api';
import { useApp } from '../ui/AppContext';
import { ReadQuickAdd } from '../ui/ReadQuickAdd';
import { useNoteQueue } from '../ui/useNoteQueue';

/** Quick add, from the deck list: words for Claude to fill in on Read & Listen's server. */
export default function ReadQuickAddRoute() {
  const router = useRouter();
  const { reader, decks } = useApp();
  const queue = useNoteQueue(reader.api);
  const settings = reader.settings?.decks;
  if (!reader.api) return <Redirect href="/read-settings" />;
  if (!settings) return null; // Read & Listen's settings are still loading.
  // Only the languages whose deck is in the collection: a language never studied has no deck to add to.
  const present = new Set(decks.map((d) => d.deck));
  const options = (Object.keys(settings) as Language[])
    .map((language) => ({ deck: settings[language], language }))
    .filter((d) => present.has(d.deck));
  const current = reader.settings?.language;
  const initial = options.find((d) => d.language === current)?.deck ?? options[0]?.deck;
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
