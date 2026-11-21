import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef } from 'react';
import type { WordChoice } from '../core/quickAdd';
import { useApp, type NoteEditorResult } from '../ui/AppContext';
import { NoteEditor } from '../ui/NoteEditor';
import { useRecorder } from '../ui/useRecorder';
import { leaveScreen } from '../ui/leaveScreen';
import { DECKS_PATH } from '../ui/tabPaths';

/**
 * Adding a note (`deck` parameter, optional; `model`, `fields`, `fieldNotes`, `tags` and `choice`, as JSON, to fill it in) or
 * editing one (`noteId`), as a sheet over the screen that opened it.
 */
export default function NoteEditorRoute() {
  const router = useRouter();
  const { repo, decks, finishNoteEditor } = useApp();
  const recorder = useRecorder();
  const { noteId, deck, model, fields, fieldNotes, tags, choice } = useLocalSearchParams<{ noteId?: string; deck?: string; model?: string; fields?: string; fieldNotes?: string; tags?: string; choice?: string }>();
  const filled = useMemo(() => {
    try { return fields ? (JSON.parse(fields) as Record<string, string>) : undefined; } catch { return undefined; }
  }, [fields]);
  const notes = useMemo(() => {
    try { return fieldNotes ? (JSON.parse(fieldNotes) as Record<string, string>) : undefined; } catch { return undefined; }
  }, [fieldNotes]);
  const startTags = useMemo(() => {
    try { return tags ? (JSON.parse(tags) as string[]) : undefined; } catch { return undefined; }
  }, [tags]);
  const wordChoice = useMemo(() => {
    try { return choice ? (JSON.parse(choice) as WordChoice) : undefined; } catch { return undefined; }
  }, [choice]);
  // The opener hears how the editor closed once it's gone, whichever way it went: Save, Delete,
  // Cancel, or swiping the sheet down, which closes it without a word from the editor.
  const result = useRef<NoteEditorResult>(undefined);
  useEffect(() => () => finishNoteEditor(result.current), [finishNoteEditor]);
  return (
    <NoteEditor
      repo={repo}
      target={noteId ? { noteId } : { deck: deck ?? null, model, fields: filled, fieldNotes: notes, tags: startTags, choice: wordChoice }}
      decks={decks.map((d) => d.deck)}
      recorder={recorder}
      onCardsChanged={() => { result.current ??= { cardsChanged: true }; }}
      onClose={(r) => { if (r) result.current = r; leaveScreen(router, DECKS_PATH); }}
    />
  );
}
