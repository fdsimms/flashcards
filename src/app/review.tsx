import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { languageOfDeck } from '../reader/practice';
import { useApp } from '../ui/AppContext';
import { Review } from '../ui/Review';

/** Studies the deck named by the `deck` parameter, and its subdecks. */
export default function ReviewRoute() {
  const router = useRouter();
  const { repo, sync, openNoteEditor, readerSettings } = useApp();
  const { deck } = useLocalSearchParams<{ deck: string }>();
  // Sync when leaving, however it's left: the Back button, the swipe, or "Back to decks".
  const syncRef = useRef(sync);
  syncRef.current = sync;
  useEffect(() => () => { syncRef.current(); }, []);
  // A Read & Listen language's deck: the session can end with a text practicing its words.
  // (`decks` is missing from a server older than the deck setting.)
  const language = readerSettings?.decks ? languageOfDeck(deck, readerSettings.decks) : null;
  const practice = readerSettings?.decks && language ? {
    languageDeck: readerSettings.decks[language],
    onRead: (words: string[]) => {
      // Synced first, so the server reads the answers just given before it writes the text.
      sync();
      router.replace({ pathname: '/read', params: { practice: JSON.stringify({ language, words }) } });
    },
  } : undefined;
  return (
    <Review
      repo={repo} deck={deck} practice={practice} onDone={() => router.back()} onEditNote={openNoteEditor}
      onPracticeForms={(request) => router.push({ pathname: '/forms-drill', params: { request: JSON.stringify(request) } })}
    />
  );
}
