import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { minedNote } from '../reader/mining';
import { useApp } from '../ui/AppContext';
import { Reader, type ReaderSource } from '../ui/Reader';
import { useWordAudio } from '../ui/useWordAudio';

/**
 * The reader. Its `source` parameter is a shelf text, a topic to write a text for, or a past text,
 * as JSON. Next replaces it with the next shelf text, in place, so Back still returns to the shelf.
 * A selected phrase's Add to deck opens the note editor, as Marked words' does (read-words.tsx).
 */
export default function ReaderRoute() {
  const router = useRouter();
  const { reader, repo, openNoteEditor } = useApp();
  const playWord = useWordAudio(repo);
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
        left: reader.miningLeft,
        onAdd: (entry, meaning) => new Promise<boolean>((resolve) => openNoteEditor(minedNote(entry, meaning, deck), (result) => {
          const saved = !!result && 'saved' in result;
          if (saved) reader.recordMined();
          resolve(saved);
        })),
      } : undefined}
    />
  );
}
