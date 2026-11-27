import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { quickAddDecks } from '../reader/noteQueue';
import { useApp } from '../ui/AppContext';
import { CramSuggest } from '../ui/cram/CramSuggest';
import { useNoteQueue } from '../ui/useNoteQueue';
import { spokenLanguage } from '../reader/languages';

/** Suggest words (or, with `mode=phrases`, phrases) for the cram named by `id` (its page's Words and Phrases, and Add's empty field): Claude suggests them for what the cram is for, and the checked ones are added. */
export default function CramSuggestRoute() {
  const router = useRouter();
  const { id, mode } = useLocalSearchParams<{ id: string; mode?: string }>();
  const { repo, reader, decks } = useApp();
  const queue = useNoteQueue(reader.api);
  const options = reader.settings ? quickAddDecks(reader.settings.decks, decks.map((d) => d.deck), spokenLanguage(reader.settings.language)) : [];
  if (!reader.api) return <Redirect href="/read-settings" />;
  return (
    <CramSuggest
      repo={repo}
      api={reader.api}
      cramId={id}
      initialMode={mode === 'phrases' ? 'phrases' : 'words'}
      queue={async (language, entries) => {
        const deck = options.find((o) => o.language === language)?.deck;
        return deck ? queue.add(language, deck, entries) : undefined;
      }}
      onDone={() => router.dismissTo({ pathname: '/cram', params: { id } })}
    />
  );
}
