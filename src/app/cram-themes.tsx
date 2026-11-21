import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { CramThemes } from '../ui/cram/CramThemes';

/** Talking points for the cram named by `id` (its page's Talking points): angles on what it's for, written by Read & Listen's server. */
export default function CramThemesRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { reader, repo } = useApp();
  if (!reader.api) return <Redirect href="/read-settings" />;
  return <CramThemes repo={repo} api={reader.api} cramId={id} onOpen={(index) => router.push({ pathname: '/cram-theme', params: { id, index: String(index) } })} />;
}
