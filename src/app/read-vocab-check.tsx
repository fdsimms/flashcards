import { Redirect, useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { useAddMinedWord } from '../ui/useAddMinedWord';
import { ReadVocabCheck } from '../ui/reader/ReadVocabCheck';
import { useWordAudio } from '../ui/useWordAudio';

/** The current Read & Listen language's vocabulary check, from its settings page. */
export default function ReadVocabCheckRoute() {
  const router = useRouter();
  const { reader, repo } = useApp();
  const addWord = useAddMinedWord();
  const playWord = useWordAudio(repo);
  const language = reader.settings?.language;
  const deck = reader.settings?.decks && language ? reader.settings.decks[language] : null;
  const current = language ? reader.settings?.common?.[language] : undefined;
  // Thai has no common words setting, and a server older than the setting doesn't send it.
  if (!reader.api || !language || current === undefined) return <Redirect href={reader.api ? '/read-language' : '/read-settings'} />;
  return (
    <ReadVocabCheck
      api={reader.api}
      language={language}
      current={current}
      onSettings={reader.setSettings}
      onPlayWord={playWord}
      // `decks` is missing from a server older than the deck setting.
      mining={deck ? {
        deck,
        onAdd: (word, meaning) => addWord({ word, meaning, deck, language }),
      } : undefined}
      onDone={() => router.back()}
    />
  );
}
