import { Redirect, useRouter } from 'expo-router';
import React from 'react';
import { quickAddDecks } from '../reader/noteQueue';
import { useApp } from '../ui/AppContext';
import { CramThemes } from '../ui/cram/CramThemes';
import { Loading, Screen } from '../ui/kit';

/** Theme ideas for a cram (Practice, Cram): themes to talk about at a lesson, written by Read & Listen's server. */
export default function CramThemesRoute() {
  const router = useRouter();
  const { reader, decks, repo } = useApp();
  if (!reader.api) return <Redirect href="/read-settings" />;
  // Read & Listen's settings are still loading.
  if (!reader.settings) return <Screen title="Theme ideas" largeTitle={false}><Loading /></Screen>;
  const languages = quickAddDecks(reader.settings.decks, decks.map((d) => d.deck), reader.settings.language).map((d) => d.language);
  if (!languages.length) return <Redirect href="/read-settings" />;
  return <CramThemes repo={repo} api={reader.api} languages={languages} onOpen={(index) => router.push({ pathname: '/cram-theme', params: { index: String(index) } })} />;
}
