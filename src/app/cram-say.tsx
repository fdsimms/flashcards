import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { withRequest } from '../core/cram';
import { quickAddDecks } from '../reader/noteQueue';
import { useApp } from '../ui/AppContext';
import { CramSay } from '../ui/cram/CramSay';
import { cramsNow, saveCram } from '../ui/useCrams';
import { useNoteQueue } from '../ui/useNoteQueue';
import { spokenLanguage } from '../reader/languages';

/**
 * Talk it through in English for the cram named by `id` (its page's Talking points): say what you want to
 * say in English, and Claude finds it in the language from your words. A word to learn sent to the note
 * queue is shown on the cram as being written; keeping the summary opens Talking points.
 */
export default function CramSayRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { reader, decks, repo } = useApp();
  const queue = useNoteQueue(reader.api);
  const api = reader.api;
  if (!api) return <Redirect href="/read-settings" />;
  const options = reader.settings ? quickAddDecks(reader.settings.decks, decks.map((d) => d.deck), spokenLanguage(reader.settings.language)) : [];
  return (
    <CramSay
      repo={repo}
      api={api}
      cramId={id}
      decks={options}
      add={async (language, deck, entries) => {
        const sent = await queue.add(language, deck, entries);
        const now = cramsNow().find((x) => x.id === id);
        if (sent && now) await saveCram(repo, entries.reduce((c, e) => withRequest(c, { text: e.entry, english: e.meaning }), now));
        return sent;
      }}
      onTalkingPoints={() => router.replace({ pathname: '/cram-themes', params: { id } })}
    />
  );
}
