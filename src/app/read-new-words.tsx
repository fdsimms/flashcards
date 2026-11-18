import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useMemo } from 'react';
import { isInDeck } from '../core/deckTree';
import { headword } from '../core/forms';
import type { Language } from '../reader/api';
import { cardsPerNote, entryKeys, heldKeys } from '../reader/newWords';
import { useApp } from '../ui/AppContext';
import { deckShortName } from '../ui/deckShortName';
import { useHeldWords } from '../ui/held';
import { SuggestedWords } from '../ui/reader/SuggestedWords';
import { useNoteQueue } from '../ui/useNoteQueue';

/** Suggested words for a language deck running low on new cards, from Today's card or a finished session. */
export default function ReadNewWordsRoute() {
  const router = useRouter();
  const { deck, language, perDay } = useLocalSearchParams<{ deck: string; language: Language; perDay: string }>();
  const { reader, repo } = useApp();
  const queue = useNoteQueue(reader.api);
  const held = useHeldWords();
  const heldForDeck = useMemo(() => heldKeys(held, deck ?? ''), [held, deck]);
  // Only reads: the note editor is the one place a note is saved (CLAUDE.md, Read & Listen).
  const loadDeck = useCallback(async () => {
    const [notes, cards] = await Promise.all([repo.listNotes(), repo.listCards()]);
    const own = notes.filter((n) => isInDeck(n.deck, deck ?? ''));
    return { entries: entryKeys(own.map(headword)), perNote: cardsPerNote(deck ?? '', notes, cards) };
  }, [repo, deck]);
  if (!reader.api) return <Redirect href="/read-settings" />;
  if (!deck || !language) return <Redirect href="/" />;
  return (
    <SuggestedWords
      deck={deck}
      name={deckShortName(deck)}
      language={language}
      perDay={Number(perDay) || 1}
      api={reader.api}
      loadDeck={loadDeck}
      held={heldForDeck}
      onAdd={queue.add}
      onDone={() => router.back()}
    />
  );
}
