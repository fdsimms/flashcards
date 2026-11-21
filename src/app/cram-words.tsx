import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { quickAddDecks } from '../reader/noteQueue';
import { useApp } from '../ui/AppContext';
import { CramWords } from '../ui/cram/CramWords';
import { useNoteQueue } from '../ui/useNoteQueue';

/** Add to the cram named by `id`, the field starting with `q` when given. Make a card is there while Read & Listen is on and has a deck in the cram's language. */
export default function CramWordsRoute() {
  const { id, q } = useLocalSearchParams<{ id: string; q?: string }>();
  const { repo, reader, decks } = useApp();
  const queue = useNoteQueue(reader.api);
  const api = reader.api;
  const options = reader.settings ? quickAddDecks(reader.settings.decks, decks.map((d) => d.deck), reader.settings.language) : [];
  return (
    <CramWords
      repo={repo}
      id={id}
      initial={q}
      findWords={api ? (language, text) => api.lessonWords(language, text) : undefined}
      queue={api ? async (language, entries) => {
        const deck = options.find((o) => o.language === language)?.deck;
        return deck ? queue.add(language, deck, entries) : undefined;
      } : undefined}
    />
  );
}
