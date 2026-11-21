import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { collectionChanged } from '../core/collectionChanged';
import { earlierDeckToStudy, nextDeckToStudy } from '../core/deckTree';
import { languageOfDeck } from '../reader/practice';
import type { WordToUse } from '../reader/production';
import { ScrollView } from 'react-native';
import { useApp } from '../ui/AppContext';
import { EmptyDeckCard } from '../ui/EmptyDeckCard';
import { Screen } from '../ui/kit';
import { readable, space } from '../ui/theme';
import { lastStudiedDeck } from '../ui/lastDeck';
import { useReviewOpen } from '../ui/reviewOpen';
import { ExtraCard } from '../ui/DailyExtras';
import { backToDecks } from '../ui/leaveScreen';
import { Review } from '../ui/Review';
import { useAddMinedWord } from '../ui/useAddMinedWord';
import { useDailyExtras } from '../ui/useDailyExtras';
import type { CardGlossing } from '../ui/useCardGlosses';
import { useWordAudio } from '../ui/useWordAudio';

/** Studies the deck named by the `deck` parameter, and its subdecks. */
export default function ReviewRoute() {
  const router = useRouter();
  const { repo, sync, decks, collapse, openNoteEditor, reader: { settings: readerSettings, api: readerApi } } = useApp();
  const { deck } = useLocalSearchParams<{ deck: string }>();
  // The Home Screen's "Study" quick action opens the deck studied last (useHomeShortcuts).
  useEffect(() => { if (deck) lastStudiedDeck.save(deck); }, [deck]);
  // Leaving the app while here doesn't sync, so Undo still works on coming back (reviewOpen.ts).
  useReviewOpen();
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
  const extras = useDailyExtras();
  const practice = readerSettings?.decks && language ? {
    languageDeck: readerSettings.decks[language],
    onRead: async (words: string[]) => {
      // Synced first, so the server reads the answers just given before it writes the text (after a
      // sync already running, which may have started before them). Unless this screen was left
      // while it ran: then the replace would land on whatever is in front.
      await sync({ afterRunning: true });
      if (left.current) return;
      router.dismissTo({ pathname: '/read', params: { practice: JSON.stringify({ language, words }) } });
    },
    // Use today's words: a sentence of one's own with each word learned in the session, checked by Claude.
    onUseWords: readerApi ? (words: WordToUse[]) => router.push({ pathname: '/read-use-words', params: { language, words: JSON.stringify(words) } }) : undefined,
  } : undefined;
  // An example sentence's words, tapped for their meanings while Read & Listen is signed in. Add to
  // deck opens the note editor on the word, in its language's deck, as the reader's does.
  const playWord = useWordAudio(repo);
  const addWord = useAddMinedWord();
  const readerDecks = readerSettings?.decks;
  const glossing = useMemo<CardGlossing | undefined>(() => (readerApi && readerDecks ? {
    api: readerApi,
    decks: readerDecks,
    onPlayWord: playWord,
    onAddWord: (word, meaning, lang, pronunciation) => addWord({ word, meaning, deck: readerDecks[lang], language: lang, pronunciation }),
  } : undefined), [readerApi, readerDecks, playWord, addWord]);
  // Custom study raises limits from a screen over this one: the deck is loaded again when it closes.
  const [reloadKey, setReloadKey] = useState(0);
  const firstFocus = useRef(true);
  useFocusEffect(useCallback(() => {
    if (firstFocus.current) { firstFocus.current = false; return; }
    setReloadKey((k) => k + 1);
  }, []));
  // And when a sync changed the cards under it: another device's answers, or the sync at launch
  // finishing after the deck was opened. Answering from the copy loaded before would write over them.
  const changed = useSyncExternalStore(collectionChanged.subscribe, collectionChanged.get);
  // The deck list's counts are from when it was last shown, which is current for every other deck.
  const nextDeck = nextDeckToStudy(decks, collapse.collapsed, deck);
  // With nothing further down the list, offer the first earlier deck that still has cards.
  const earlierDeck = nextDeck ? undefined : earlierDeckToStudy(decks, collapse.collapsed, deck);
  // A deck with no cards yet (just made): what to do next, in place of "All done for now".
  if (decks.find((r) => r.deck === deck)?.cards === 0) {
    return (
      <Screen title={deck.split('::').pop() ?? deck}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, padding: space.l }}>
          <EmptyDeckCard deck={deck} />
        </ScrollView>
      </Screen>
    );
  }
  return (
    <Review
      repo={repo} deck={deck} practice={practice} extraCard={language ? <ExtraCard extras={extras} language={language} /> : undefined} glossing={glossing} onAddWord={addWord} suggestHints={readerApi ? (q) => readerApi.mnemonics(q) : undefined} askAboutCard={readerApi ? (card, turns) => readerApi.askCard(card, turns) : undefined} fixFlaggedCard={readerApi ? (request) => readerApi.fixCard(request) : undefined} reloadKey={reloadKey + changed} onDone={() => backToDecks(router)} onEditNote={openNoteEditor}
      nextDeck={nextDeck?.split('::').pop()}
      onNextDeck={nextDeck ? () => router.replace({ pathname: '/review', params: { deck: nextDeck } }) : undefined}
      earlierDeck={earlierDeck?.split('::').pop()}
      onEarlierDeck={earlierDeck ? () => router.replace({ pathname: '/review', params: { deck: earlierDeck } }) : undefined}
      onCustomStudy={() => router.push({ pathname: '/custom-study', params: { deck } })}
      onSkillCards={() => router.push({ pathname: '/skill-cards', params: { deck } })}
      onCardInfo={(card) => router.push({ pathname: '/card-info', params: { card } })}
      onSettings={() => router.push({ pathname: '/settings-page', params: { page: 'decks' } })}
      onPracticeForms={(request) => router.push({ pathname: '/forms-drill', params: { request: JSON.stringify(request) } })}
      onPracticeMixups={(request) => router.push({ pathname: '/tool', params: { id: 'mixups', notes: JSON.stringify(request.noteIds), mode: request.mode, language: request.language } })}
    />
  );
}
