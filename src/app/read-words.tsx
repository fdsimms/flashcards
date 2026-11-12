import { Redirect } from 'expo-router';
import React from 'react';
import { minedNote } from '../reader/mining';
import { useApp } from '../ui/AppContext';
import { ReadWords } from '../ui/ReadWords';

/**
 * Words marked unknown while reading. Add to deck opens the note editor with the word filled in:
 * saving there is the approval, and nothing reaches the deck otherwise (CLAUDE.md, Read & Listen).
 */
export default function ReadWordsRoute() {
  const { reader, openNoteEditor } = useApp();
  if (!reader.api) return <Redirect href="/read-settings" />;
  // `decks` is missing from a server older than the deck setting.
  const deck = reader.settings?.decks ? reader.settings.decks[reader.settings.language] : null;
  return (
    <ReadWords
      api={reader.api}
      mining={deck ? {
        deck,
        left: reader.miningLeft,
        onAdd: (w) => new Promise<boolean>((resolve) => openNoteEditor(minedNote(w.word, w.gloss, deck), (result) => {
          const saved = !!result && 'saved' in result;
          if (saved) reader.recordMined();
          resolve(saved);
        })),
      } : undefined}
    />
  );
}
