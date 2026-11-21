import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { CramEditor } from '../ui/cram/CramEditor';

/** A new cram, or the one named by `id` to edit, as a sheet. "Not sure yet? Get ideas" needs Read & Listen. */
export default function CramEditRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { repo, reader } = useApp();
  return <CramEditor repo={repo} id={id || undefined} canSuggest={!!reader.api} />;
}
