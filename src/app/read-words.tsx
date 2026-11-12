import { Redirect } from 'expo-router';
import React, { useState } from 'react';
import { minedNote } from '../reader/mining';
import { useApp } from '../ui/AppContext';
import { ReadWords } from '../ui/ReadWords';

/**
 * Words marked unknown while reading. Add to deck opens the note editor with the word filled in:
 * saving there is the approval, and nothing reaches the deck otherwise (CLAUDE.md, Read & Listen).
 */
export default function ReadWordsRoute() {
  const { readerApi, readerSettings, openNoteEditor, miningLeft, recordMined } = useApp();
  // Bumped after a word is added, so the list loads again without it.
  const [version, setVersion] = useState(0);
  if (!readerApi) return <Redirect href="/read-settings" />;
  // `decks` is missing from a server older than the deck setting.
  const deck = readerSettings?.decks ? readerSettings.decks[readerSettings.language] : null;
  return (
    <ReadWords
      key={version}
      api={readerApi}
      mining={deck ? {
        deck,
        left: miningLeft,
        onAdd: (w) => openNoteEditor(minedNote(w.word, w.gloss, deck), (result) => {
          if (!result || !('saved' in result)) return;
          recordMined();
          // Off the list once it's in the deck, as Clear does.
          readerApi.clearWord(w.word).catch(() => undefined).finally(() => setVersion((v) => v + 1));
        }),
      } : undefined}
    />
  );
}
