import { Redirect, useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { ReadLanguage } from '../ui/ReadLanguage';

/** The current Read & Listen language's settings, from the shelf's sliders button. */
export default function ReadLanguageRoute() {
  const router = useRouter();
  const { reader, decks } = useApp();
  if (!reader.api) return <Redirect href="/read-settings" />;
  const language = reader.settings?.language ?? 'th';
  return (
    <ReadLanguage
      api={reader.api}
      deckNames={decks.map((d) => d.deck)}
      onSettings={reader.setSettings}
      onVoices={() => router.push({ pathname: '/read-voices', params: { language } })}
      onGrammar={() => router.push('/read-grammar')}
      onEpisodes={(story) => router.push({ pathname: '/read-past', params: { story: String(story) } })}
    />
  );
}
