import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../../../ui/AppContext';
import { ReadShelf } from '../../../ui/reader/ReadShelf';
import { useWordAudio } from '../../../ui/useWordAudio';

/**
 * Read & Listen's home: the shelf of the language last read. Sends you to its settings when it
 * isn't signed in. Its `language` parameter (franki://read?language=de, the link on dundundun's Read & Listen task) switches the shelf to that language.
 */
export default function ReadRoute() {
  const router = useRouter();
  const { reader, repo } = useApp();
  const playWord = useWordAudio(repo);
  const { language: linkLanguage } = useLocalSearchParams<{ language?: string }>();
  if (!reader.api) return <Redirect href="/read-settings" />;
  const api = reader.api;
  return (
    <ReadShelf
      api={api}
      knownLanguage={reader.settings?.language}
      openLanguage={linkLanguage || undefined}
      onOpenedLanguage={() => router.setParams({ language: '' })}
      onPlayWord={playWord}
      onOpen={(open) => (open.watch
        ? router.push({ pathname: '/watch', params: { text: String(open.textId) } })
        : router.push({ pathname: '/reader', params: { source: JSON.stringify({ kind: 'shelf', ...open }) } }))}
      onGrammarLesson={(id) => router.push({ pathname: '/read-grammar-lesson', params: { id } })}
      onNew={() => router.push('/read-write')}
      onNewSeries={() => router.push({ pathname: '/read-write', params: { kind: 'series' } })}
      onSettings={() => router.push({ pathname: '/settings-page', params: { page: 'read' } })}
      onPast={() => router.push('/read-past')}
      onReadAgain={(text) => router.push({ pathname: '/reader', params: { source: JSON.stringify({ kind: 'past', text }) } })}
      onStory={(story) => router.push({ pathname: '/read-story', params: { story: String(story) } })}
      onStories={() => router.push('/read-stories')}
      onWords={() => router.push('/read-words')}
      onLanguage={() => { api.settings().then(reader.setSettings, () => undefined); }}
      onReview={(deck) => router.push({ pathname: '/review', params: { deck } })}
      onListenAgain={([first, ...rest]) => router.push({ pathname: '/reader', params: { source: JSON.stringify({ kind: 'past', text: first, listen: rest }) } })}
    />
  );
}
