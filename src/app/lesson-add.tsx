import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo } from 'react';
import { isInDeck } from '../core/deckTree';
import { headword } from '../core/forms';
import type { AudioLesson } from '../reader/api';
import { entryKeys } from '../reader/newWords';
import { useApp, type NoteEditorResult } from '../ui/AppContext';
import { LessonAddToDeck } from '../ui/reader/LessonAddToDeck';
import { useRecorder } from '../ui/useRecorder';
import type { MinedNote } from '../reader/mining';
import { leaveScreen } from '../ui/leaveScreen';
import { DECKS_PATH, LESSONS_PATH } from '../ui/tabPaths';

/** A lesson's phrases to add to the deck of the language it's in (`lesson`, as the player was given it). */
export default function LessonAddRoute() {
  const router = useRouter();
  const { repo, reader, openNoteEditor } = useApp();
  const recorder = useRecorder();
  const { lesson: raw } = useLocalSearchParams<{ lesson?: string }>();
  const lesson = useMemo(() => {
    try { return raw ? (JSON.parse(raw) as AudioLesson) : null; } catch { return null; }
  }, [raw]);
  const deck = lesson ? reader.settings?.decks?.[lesson.language] : undefined;
  // Read & Listen was turned off, or the language has no deck: nothing to add to.
  const ready = !!reader.api && !!lesson && !!deck && !!recorder;
  useEffect(() => { if (!ready) leaveScreen(router, DECKS_PATH); }, [ready, router]);
  // Only reads: the note editor is the one place a note is saved.
  const loadEntries = useCallback(async () => {
    const notes = await repo.listNotes();
    return entryKeys(notes.filter((n) => isInDeck(n.deck, deck ?? '')).map(headword));
  }, [repo, deck]);
  const edit = useCallback((note: MinedNote) => new Promise<NoteEditorResult | undefined>((resolve) => openNoteEditor(note, resolve)), [openNoteEditor]);
  if (!ready) return null;
  return (
    <LessonAddToDeck
      api={reader.api!}
      lesson={lesson!}
      language={lesson!.language}
      deck={deck!}
      recorder={recorder!}
      loadEntries={loadEntries}
      edit={edit}
      onDone={() => leaveScreen(router, LESSONS_PATH)}
    />
  );
}
