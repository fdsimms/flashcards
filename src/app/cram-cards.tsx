import { Redirect, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { loadParticle } from '../reader/lessonStorage';
import { quickAddDecks } from '../reader/noteQueue';
import { useApp } from '../ui/AppContext';
import { CramMakeCards } from '../ui/cram/CramMakeCards';
import { useNoteQueue } from '../ui/useNoteQueue';

/** Make cards for all the words jotted down in the lesson of the cram named by `id`. Needs Read & Listen. */
export default function CramCardsRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { repo, reader, decks } = useApp();
  const queue = useNoteQueue(reader.api);
  const api = reader.api;
  if (!api) return <Redirect href="/read-settings" />;
  const options = reader.settings ? quickAddDecks(reader.settings.decks, decks.map((d) => d.deck), reader.settings.language) : [];
  return (
    <CramMakeCards
      repo={repo}
      id={id}
      deckFor={(language) => options.find((o) => o.language === language)?.deck}
      findWords={async (language, text) => api.lessonWords(language, text, await loadParticle())}
      queue={async (language, entries) => {
        const deck = options.find((o) => o.language === language)?.deck;
        return deck ? queue.add(language, deck, entries) : undefined;
      }}
    />
  );
}
