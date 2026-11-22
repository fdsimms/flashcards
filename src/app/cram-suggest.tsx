import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { quickAddDecks } from '../reader/noteQueue';
import { useApp } from '../ui/AppContext';
import { CramSuggest } from '../ui/cram/CramSuggest';
import { useNoteQueue } from '../ui/useNoteQueue';

/** Suggest words for the cram named by `id` (its page's Words, and Add's empty field): Claude names words for what it's for, and the checked ones are added. */
export default function CramSuggestRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { repo, reader, decks } = useApp();
  const queue = useNoteQueue(reader.api);
  const options = reader.settings ? quickAddDecks(reader.settings.decks, decks.map((d) => d.deck), reader.settings.language) : [];
  if (!reader.api) return <Redirect href="/read-settings" />;
  return (
    <CramSuggest
      repo={repo}
      api={reader.api}
      cramId={id}
      queue={async (language, entries) => {
        const deck = options.find((o) => o.language === language)?.deck;
        return deck ? queue.add(language, deck, entries) : undefined;
      }}
      onDone={() => router.dismissTo({ pathname: '/cram', params: { id } })}
    />
  );
}
