import { Redirect } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { useAddMinedWord } from '../ui/useAddMinedWord';
import { ReadWords } from '../ui/reader/ReadWords';
import { deckOf } from '../reader/languages';

/**
 * Words marked unknown while reading. Add to deck opens the note editor with the word filled in:
 * saving there is the approval, and nothing reaches the deck otherwise (CLAUDE.md, Read & Listen).
 */
export default function ReadWordsRoute() {
  const { reader } = useApp();
  const addWord = useAddMinedWord();
  if (!reader.api) return <Redirect href="/read-settings" />;
  // `decks` is missing from a server older than the deck setting.
  const deck = reader.settings?.decks ? deckOf(reader.settings, reader.settings.language) ?? null : null;
  return (
    <ReadWords
      api={reader.api}
      mining={deck ? {
        deck,
        onAdd: (w) => addWord({ word: w.word, meaning: w.gloss, deck, language: reader.settings?.language, pronunciation: w }),
      } : undefined}
    />
  );
}
