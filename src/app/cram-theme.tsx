import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { talkOf, themeDeckWords } from '../core/cramThemes';
import { withRequest } from '../core/cram';
import { quickAddDecks } from '../reader/noteQueue';
import { rehearsalParams } from '../reader/situations';
import { useApp } from '../ui/AppContext';
import { CramThemeDetail } from '../ui/cram/CramThemeDetail';
import { applyTheme, capCramCards, cramsNow, saveCram } from '../ui/useCrams';
import { useNoteQueue } from '../ui/useNoteQueue';

/**
 * One of a cram's talking points, by its place in the list (`index`), or its story (`view=story`).
 * Use theme keeps its questions and story on the cram (`id`) and adds its words; a word to learn sent
 * to the note queue is shown on the cram as being written. Rehearse opens Situations on it.
 */
export default function CramThemeRoute() {
  const router = useRouter();
  const { id, index, view } = useLocalSearchParams<{ id: string; index: string; view?: string }>();
  const { reader, decks, repo } = useApp();
  const queue = useNoteQueue(reader.api);
  if (!reader.api) return <Redirect href="/read-settings" />;
  const options = reader.settings ? quickAddDecks(reader.settings.decks, decks.map((d) => d.deck), reader.settings.language) : [];
  const cram = () => cramsNow().find((x) => x.id === id);
  return (
    <CramThemeDetail
      repo={repo}
      index={Number(index) || 0}
      view={view === 'story' ? 'story' : 'theme'}
      decks={options}
      add={async (language, deck, entries) => {
        const sent = await queue.add(language, deck, entries);
        const now = cram();
        if (sent && now) await saveCram(repo, entries.reduce((c, e) => withRequest(c, { text: e.entry, english: e.meaning }), now));
        return sent;
      }}
      onStory={() => router.push({ pathname: '/cram-theme', params: { id, index, view: 'story' } })}
      onRehearse={(language, scene, words) => router.push({ pathname: '/tool', params: rehearsalParams(language, scene, words, cram()?.register) })}
      onUse={async (theme, words) => {
        const now = cram();
        if (!now) return;
        await applyTheme(repo, now, talkOf(theme), themeDeckWords(theme, words).map((w) => w.noteId));
        capCramCards(repo).catch(() => undefined);
        router.dismissTo({ pathname: '/cram', params: { id } });
      }}
    />
  );
}
