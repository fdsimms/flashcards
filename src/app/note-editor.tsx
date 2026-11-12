import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { useApp } from '../ui/AppContext';
import { NoteEditor } from '../ui/NoteEditor';

/**
 * Adding a note (`deck` parameter, optional; `model` and `fields`, as JSON, to fill it in) or
 * editing one (`noteId`), as a sheet over the screen that opened it.
 */
export default function NoteEditorRoute() {
  const router = useRouter();
  const { repo, finishNoteEditor } = useApp();
  const { noteId, deck, model, fields } = useLocalSearchParams<{ noteId?: string; deck?: string; model?: string; fields?: string }>();
  const filled = useMemo(() => {
    try { return fields ? (JSON.parse(fields) as Record<string, string>) : undefined; } catch { return undefined; }
  }, [fields]);
  return (
    <NoteEditor
      repo={repo}
      target={noteId ? { noteId } : { deck: deck ?? null, model, fields: filled }}
      onClose={(result) => { finishNoteEditor(result); router.back(); }}
    />
  );
}
