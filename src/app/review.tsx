import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { earlierDeckToStudy, nextDeckToStudy } from '../core/deckTree';
import { minedNote } from '../reader/mining';
import { languageOfDeck } from '../reader/practice';
import { useApp } from '../ui/AppContext';
import { Review } from '../ui/Review';
import type { CardGlossing } from '../ui/useCardGlosses';
import { useWordAudio } from '../ui/useWordAudio';

/** Studies the deck named by the `deck` parameter, and its subdecks. */
export default function ReviewRoute() {
  const router = useRouter();
  const { repo, sync, decks, collapse, openNoteEditor, reader: { settings: readerSettings, api: readerApi } } = useApp();
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
  // An example sentence's words, tapped for their meanings while Read & Listen is signed in. Add to
  // deck opens the note editor on the word, in its language's deck, as the reader's does.
  const playWord = useWordAudio(repo);
  const readerDecks = readerSettings?.decks;
  const glossing = useMemo<CardGlossing | undefined>(() => (readerApi && readerDecks ? {
    api: readerApi,
    decks: readerDecks,
    onPlayWord: playWord,
    onAddWord: (word, meaning, lang) => new Promise<boolean>((resolve) => openNoteEditor(minedNote(word, meaning, readerDecks[lang]), (result) => {
      resolve(!!result && 'saved' in result);
    })),
  } : undefined), [readerApi, readerDecks, playWord, openNoteEditor]);
  // Custom study raises limits from a screen over this one: the deck is loaded again when it closes.
  const [reloadKey, setReloadKey] = useState(0);
  const firstFocus = useRef(true);
  useFocusEffect(useCallback(() => {
    if (firstFocus.current) { firstFocus.current = false; return; }
    setReloadKey((k) => k + 1);
  }, []));
  // The deck list's counts are from when it was last shown, which is current for every other deck.
  const nextDeck = nextDeckToStudy(decks, collapse.collapsed, deck);
  // With nothing further down the list, offer the first earlier deck that still has cards.
  const earlierDeck = nextDeck ? undefined : earlierDeckToStudy(decks, collapse.collapsed, deck);
  return (
    <Review
      repo={repo} deck={deck} practice={practice} glossing={glossing} suggestHints={readerApi ? (q) => readerApi.mnemonics(q) : undefined} reloadKey={reloadKey} onDone={() => router.back()} onEditNote={openNoteEditor}
      nextDeck={nextDeck?.split('::').pop()}
      onNextDeck={nextDeck ? () => router.replace({ pathname: '/review', params: { deck: nextDeck } }) : undefined}
      earlierDeck={earlierDeck?.split('::').pop()}
      onEarlierDeck={earlierDeck ? () => router.replace({ pathname: '/review', params: { deck: earlierDeck } }) : undefined}
      onCustomStudy={() => router.push({ pathname: '/custom-study', params: { deck } })}
      onCardInfo={(card) => router.push({ pathname: '/card-info', params: { card } })}
      onPracticeForms={(request) => router.push({ pathname: '/forms-drill', params: { request: JSON.stringify(request) } })}
    />
  );
}
