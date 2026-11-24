import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useApp } from '../ui/AppContext';
import { Browse } from '../ui/Browse';

/** The whole collection, or one deck and its subdecks when opened with a `deck` parameter (Review's "Browse cards"). */
export default function BrowseRoute() {
  const { repo, openNoteEditor } = useApp();
  const { deck } = useLocalSearchParams<{ deck?: string }>();
  return <Browse repo={repo} onEditNote={openNoteEditor} initialDeck={deck || null} />;
}
