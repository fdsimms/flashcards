import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { useApp } from '../ui/AppContext';
import { Reader, type ReaderSource } from '../ui/reader/Reader';
import { useAddMinedWord } from '../ui/useAddMinedWord';
import { useReaderPlayerHost } from '../ui/useReaderPlayer';
import { useWordAudio } from '../ui/useWordAudio';

/**
 * The reader. Its `source` parameter is a shelf text, a topic to write a text for, or a past text,
 * as JSON. Next replaces it with the next shelf text, in place, so Back still returns to the shelf.
 * A selected phrase's Add to deck opens the note editor, as Marked words' does (read-words.tsx).
 */
export default function ReaderRoute() {
  const router = useRouter();
  const { reader, repo } = useApp();
  const addWord = useAddMinedWord();
  const playWord = useWordAudio(repo);
  const playerHost = useReaderPlayerHost();
  const readerApi = reader.api;
  const { source: raw } = useLocalSearchParams<{ source: string }>();
  const source = useMemo<ReaderSource | null>(() => {
    try { return JSON.parse(raw) as ReaderSource; } catch { return null; }
  }, [raw]);
  if (!readerApi || !source) return <Redirect href={readerApi ? '/read' : '/read-settings'} />;
  // `decks` is missing from a server older than the deck setting.
  const language = reader.settings?.language;
  const deck = language && reader.settings?.decks ? reader.settings.decks[language] : null;
  return (
    <Reader
      api={readerApi}
      playerHost={playerHost}
      source={source}
      settings={reader.settings}
      onSettings={reader.setSettings}
      onPlayWord={playWord}
      onNext={(next) => router.setParams({ source: JSON.stringify(next) })}
      onDone={() => router.back()}
      onOpenGrammar={(id) => router.push({ pathname: '/read-grammar-point', params: { id } })}
      mining={language && deck ? {
        language,
        deck,
        onAdd: (entry, meaning, pronunciation) => addWord({ word: entry, meaning, deck, language, pronunciation }),
      } : undefined}
    />
  );
}
