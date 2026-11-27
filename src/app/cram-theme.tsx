import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { talkOf } from '../core/cramThemes';
import { preparedLines, withRequest } from '../core/cram';
import { quickAddDecks } from '../reader/noteQueue';
import { rehearsalParams } from '../reader/situations';
import { useApp } from '../ui/AppContext';
import { CramThemeDetail } from '../ui/cram/CramThemeDetail';
import { applyThemes, capCramCards, cramsNow, saveCram } from '../ui/useCrams';
import { useNoteQueue } from '../ui/useNoteQueue';
import { spokenLanguage } from '../reader/languages';

/**
 * One of a cram's talking points, by its place in the list (`index`), or its story (`view=story`).
 * Use theme keeps its questions, answers and story on the cram (`id`) and adds its words; a word to
 * learn sent to the note queue is shown on the cram as being written. Rehearse opens Situations on it,
 * with its questions for the tutor to steer by, and an edited story is checked by Read & Listen.
 */
export default function CramThemeRoute() {
  const router = useRouter();
  const { id, index, view } = useLocalSearchParams<{ id: string; index: string; view?: string }>();
  const { reader, decks, repo } = useApp();
  const queue = useNoteQueue(reader.api);
  const api = reader.api;
  if (!api) return <Redirect href="/read-settings" />;
  const options = reader.settings ? quickAddDecks(reader.settings.decks, decks.map((d) => d.deck), spokenLanguage(reader.settings.language)) : [];
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
      check={(language, attempt, story) => api.checkWriting({ kind: 'translate', language, attempt, english: story.english, reference: story.text })}
      onStory={() => router.push({ pathname: '/cram-theme', params: { id, index, view: 'story' } })}
      onRehearse={(language, theme, words) => router.push({ pathname: '/tool', params: rehearsalParams(language, theme.title, words, cram()?.register, preparedLines({ themes: [talkOf(theme)] })) })}
      onUse={async (theme, noteIds) => {
        const now = cram();
        if (!now) return;
        await applyThemes(repo, now, [talkOf(theme)], noteIds);
        capCramCards(repo).catch(() => undefined);
        router.dismissTo({ pathname: '/cram', params: { id } });
      }}
    />
  );
}
