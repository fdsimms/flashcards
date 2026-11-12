import React from 'react';
import { useApp } from '../ui/AppContext';
import { Browse } from '../ui/Browse';

export default function BrowseRoute() {
  const { repo, openNoteEditor } = useApp();
  return <Browse repo={repo} onEditNote={openNoteEditor} />;
}
