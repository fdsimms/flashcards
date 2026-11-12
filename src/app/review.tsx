import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { languageOfDeck } from '../reader/practice';
import { useApp } from '../ui/AppContext';
import { Review } from '../ui/Review';

/** Studies the deck named by the `deck` parameter, and its subdecks. */
export default function ReviewRoute() {
  const router = useRouter();
  const { repo, sync, openNoteEditor, reader: { settings: readerSettings } } = useApp();
  const { deck } = useLocalSearchParams<{ deck: string }>();
  // Sync when leaving, however it's left: the Back button, the swipe, or "Back to decks".
  const syncRef = useRef(sync);
  syncRef.current = sync;
  const left = useRef(false);
  useEffect(() => {
    left.current = false;
    return () => { left.current = true; syncRef.current(); };
  }, []);
  // A Read & Listen language's deck: the session can end with a text practicing its words.
  // (`decks` is missing from a server older than the deck setting.)
  const language = readerSettings?.decks ? languageOfDeck(deck, readerSettings.decks) : null;
  const practice = readerSettings?.decks && language ? {
    languageDeck: readerSettings.decks[language],
    onRead: async (words: string[]) => {
      // Synced first, so the server reads the answers just given before it writes the text. Unless
      // this screen was left while it ran: then the replace would land on whatever is in front.
      await sync();
      if (left.current) return;
      router.dismissTo({ pathname: '/read', params: { practice: JSON.stringify({ language, words }) } });
    },
  } : undefined;
  // Custom study raises limits from a screen over this one: the deck is loaded again when it closes.
  const [reloadKey, setReloadKey] = useState(0);
  const firstFocus = useRef(true);
  useFocusEffect(useCallback(() => {
    if (firstFocus.current) { firstFocus.current = false; return; }
    setReloadKey((k) => k + 1);
  }, []));
  return (
    <Review
      repo={repo} deck={deck} practice={practice} reloadKey={reloadKey} onDone={() => router.back()} onEditNote={openNoteEditor}
      onCustomStudy={() => router.push({ pathname: '/custom-study', params: { deck } })}
      onCardInfo={(card) => router.push({ pathname: '/card-info', params: { card } })}
      onPracticeForms={(request) => router.push({ pathname: '/forms-drill', params: { request: JSON.stringify(request) } })}
    />
  );
}
