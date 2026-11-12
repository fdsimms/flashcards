import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { useApp, type NoteEditorResult } from '../ui/AppContext';
import { NoteEditor } from '../ui/NoteEditor';

/** Adding a note (`deck` parameter, optional) or editing one (`noteId`), as a sheet over the screen that opened it. */
export default function NoteEditorRoute() {
  const router = useRouter();
  const { repo, finishNoteEditor } = useApp();
  const { noteId, deck } = useLocalSearchParams<{ noteId?: string; deck?: string }>();
  // The opener hears how the editor closed once it's gone, whichever way it went: Save, Delete,
  // Cancel, or swiping the sheet down, which closes it without a word from the editor.
  const result = useRef<NoteEditorResult>(undefined);
  useEffect(() => () => finishNoteEditor(result.current), [finishNoteEditor]);
  return (
    <NoteEditor
      repo={repo}
      target={noteId ? { noteId } : { deck: deck ?? null }}
      onCardsChanged={() => { result.current ??= { cardsChanged: true }; }}
      onClose={(r) => { if (r) result.current = r; router.back(); }}
    />
  );
}
