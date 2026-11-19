import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { CramEditor } from '../ui/cram/CramEditor';

/** A new cram, or the one named by `id` to edit, as a sheet. A new one can ask for theme ideas while Read & Listen is on. */
export default function CramEditRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { repo, reader } = useApp();
  return <CramEditor repo={repo} id={id || undefined} onSuggest={reader.api ? () => router.push('/cram-themes') : undefined} />;
}
