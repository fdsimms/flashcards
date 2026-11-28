import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { deckOf } from '../reader/languages';
import { useApp } from '../ui/AppContext';
import { leaveScreen } from '../ui/leaveScreen';
import { ReadWatch } from '../ui/reader/ReadWatch';
import { READ_PATH } from '../ui/tabPaths';
import { useAddMinedWord } from '../ui/useAddMinedWord';
import { useWordAudio } from '../ui/useWordAudio';

/** Watch: a video's text read under the video, from its cover in the shelf's Your texts row. */
export default function WatchRoute() {
  const router = useRouter();
  const { reader, repo } = useApp();
  const addWord = useAddMinedWord();
  const playWord = useWordAudio(repo);
  const { text } = useLocalSearchParams<{ text?: string }>();
  const textId = Number(text);
  if (!reader.api || !Number.isInteger(textId)) return <Redirect href={reader.api ? '/read' : '/read-settings'} />;
  // `decks` is missing from a server older than the deck setting.
  const language = reader.settings?.language;
  const deck = language && reader.settings?.decks ? deckOf(reader.settings, language) ?? null : null;
  return (
    <ReadWatch
      api={reader.api}
      textId={textId}
      onPlayWord={playWord}
      mining={language && deck ? { language, onAdd: (entry, meaning, pronunciation) => addWord({ word: entry, meaning, deck, language, pronunciation }) } : undefined}
      onDone={() => leaveScreen(router, READ_PATH)}
    />
  );
}
