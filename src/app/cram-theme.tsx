import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { quickAddDecks } from '../reader/noteQueue';
import { useApp } from '../ui/AppContext';
import { CramThemeDetail } from '../ui/cram/CramThemeDetail';
import { useNoteQueue } from '../ui/useNoteQueue';

/** One of the theme ideas, by its place in the list (`index`), or its story (`view=story`). Using it opens the new cram's sheet. */
export default function CramThemeRoute() {
  const router = useRouter();
  const { index, view } = useLocalSearchParams<{ index: string; view?: string }>();
  const { reader, decks, repo } = useApp();
  const queue = useNoteQueue(reader.api);
  if (!reader.api) return <Redirect href="/read-settings" />;
  const options = reader.settings ? quickAddDecks(reader.settings.decks, decks.map((d) => d.deck), reader.settings.language) : [];
  return (
    <CramThemeDetail
      repo={repo}
      index={Number(index) || 0}
      view={view === 'story' ? 'story' : 'theme'}
      decks={options}
      add={queue.add}
      onStory={() => router.push({ pathname: '/cram-theme', params: { index, view: 'story' } })}
      onUse={() => router.dismissTo('/cram-edit')}
    />
  );
}
