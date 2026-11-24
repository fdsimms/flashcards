import { useMemo } from 'react';
import type { Repo } from '../db/repo';
import { useApp } from './AppContext';
import type { CardGlossing } from './useCardGlosses';
import { useAddMinedWord } from './useAddMinedWord';
import { useWordAudio } from './useWordAudio';

/**
 * What a card needs to make its example sentence's words tappable (useCardGlosses), present while
 * Read & Listen is signed in: its server, its decks, and what a popover's Play and Add to deck do
 * (Add to deck opens the note editor on the word, in its language's deck, as the reader's does).
 * Review and the cram round both build their cards' back from `Side`, so both take it from here.
 */
export function useCardGlossing(repo: Repo): CardGlossing | undefined {
  const { reader: { settings, api } } = useApp();
  const playWord = useWordAudio(repo);
  const addWord = useAddMinedWord();
  const decks = settings?.decks;
  const glossOnlyDecks = settings?.glossOnlyDecks;
  return useMemo(() => {
    if (!api || !decks) return undefined;
    const glossDecks = { ...decks, ...glossOnlyDecks };
    return {
      api,
      decks,
      glossDecks,
      onPlayWord: playWord,
      // Toki Pona's word goes to the note queue like any other, into its own deck.
      onAddWord: async (word, meaning, lang, pronunciation) => {
        const deck = glossDecks[lang];
        return deck ? addWord({ word, meaning, deck, language: lang, pronunciation }) : false;
      },
    } satisfies CardGlossing;
  }, [api, decks, glossOnlyDecks, playWord, addWord]);
}
