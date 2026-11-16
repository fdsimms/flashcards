import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef } from 'react';
import { useApp, type NoteEditorResult } from '../ui/AppContext';
import { NoteEditor } from '../ui/NoteEditor';
import { useRecorder } from '../ui/useRecorder';

/**
 * Adding a note (`deck` parameter, optional; `model`, `fields`, `fieldNotes` and `tags`, as JSON, to fill it in) or
 * editing one (`noteId`), as a sheet over the screen that opened it.
 */
export default function NoteEditorRoute() {
  const router = useRouter();
  const { repo, decks, finishNoteEditor } = useApp();
  const recorder = useRecorder();
  const { noteId, deck, model, fields, fieldNotes, tags } = useLocalSearchParams<{ noteId?: string; deck?: string; model?: string; fields?: string; fieldNotes?: string; tags?: string }>();
  const filled = useMemo(() => {
    try { return fields ? (JSON.parse(fields) as Record<string, string>) : undefined; } catch { return undefined; }
  }, [fields]);
  const notes = useMemo(() => {
    try { return fieldNotes ? (JSON.parse(fieldNotes) as Record<string, string>) : undefined; } catch { return undefined; }
  }, [fieldNotes]);
  const startTags = useMemo(() => {
    try { return tags ? (JSON.parse(tags) as string[]) : undefined; } catch { return undefined; }
  }, [tags]);
  // The opener hears how the editor closed once it's gone, whichever way it went: Save, Delete,
  // Cancel, or swiping the sheet down, which closes it without a word from the editor.
  const result = useRef<NoteEditorResult>(undefined);
  useEffect(() => () => finishNoteEditor(result.current), [finishNoteEditor]);
  return (
    <NoteEditor
      repo={repo}
      target={noteId ? { noteId } : { deck: deck ?? null, model, fields: filled, fieldNotes: notes, tags: startTags }}
      decks={decks.map((d) => d.deck)}
      recorder={recorder}
      onCardsChanged={() => { result.current ??= { cardsChanged: true }; }}
      onClose={(r) => { if (r) result.current = r; router.back(); }}
    />
  );
}
