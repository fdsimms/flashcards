import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { talkOf } from '../core/cramThemes';
import { useApp } from '../ui/AppContext';
import { CramThemes } from '../ui/cram/CramThemes';
import { applyThemes, capCramCards, cramsNow } from '../ui/useCrams';

/** Talking points for the cram named by `id` (its page's Talking points): angles on what it's for, written by Read & Listen's server. Checked themes are kept together with Use themes. */
export default function CramThemesRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { reader, repo } = useApp();
  if (!reader.api) return <Redirect href="/read-settings" />;
  return (
    <CramThemes
      repo={repo}
      api={reader.api}
      cramId={id}
      onOpen={(index) => router.push({ pathname: '/cram-theme', params: { id, index: String(index) } })}
      onUse={async (themes, noteIds) => {
        const now = cramsNow().find((x) => x.id === id);
        if (!now) return;
        await applyThemes(repo, now, themes.map(talkOf), noteIds);
        capCramCards(repo).catch(() => undefined);
        router.dismissTo({ pathname: '/cram', params: { id } });
      }}
    />
  );
}
