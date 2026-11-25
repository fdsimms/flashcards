import type { ExplanationGlossing } from './reader/GrammarExplanation';
import { useApp } from './AppContext';
import { useAddMinedWord } from './useAddMinedWord';
import { useWordAudio } from './useWordAudio';

/**
 * What a tapped word in a grammar explanation does, on a point's page and its lesson alike: plays
 * it, or adds it to its language's deck as the reader's words are (the note editor is the approval).
 */
export function useGrammarGlossing(): Omit<ExplanationGlossing, 'api'> {
  const { repo, reader } = useApp();
  const playWord = useWordAudio(repo);
  const addWord = useAddMinedWord();
  return {
    onPlayWord: playWord,
    onAddWord: async (word, meaning, lang, pronunciation) => {
      const wordDeck = reader.settings?.decks?.[lang];
      return wordDeck ? addWord({ word, meaning, deck: wordDeck, language: lang, pronunciation }) : false;
    },
  };
}
