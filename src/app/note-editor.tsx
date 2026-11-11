import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { NoteEditor } from '../ui/NoteEditor';

/** Adding a note (`deck` parameter, optional) or editing one (`noteId`), as a sheet over the screen that opened it. */
export default function NoteEditorRoute() {
  const router = useRouter();
  const { repo, finishNoteEditor } = useApp();
  const { noteId, deck } = useLocalSearchParams<{ noteId?: string; deck?: string }>();
  return (
    <NoteEditor
      repo={repo}
      target={noteId ? { noteId } : { deck: deck ?? null }}
      onClose={(result) => { finishNoteEditor(result); router.back(); }}
    />
  );
}
