import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useRef } from 'react';
import { useApp } from '../ui/AppContext';
import { CramPage } from '../ui/cram/CramPage';
import { useNoteQueue } from '../ui/useNoteQueue';
import { useReadWithWords } from '../ui/useReadWithWords';
import { useReviewQueued } from '../ui/useReviewQueued';

/** A cram's page, by its `id`. Read a text writes one with the cram's words and opens it, as Review's does (useReadWithWords). */
export default function CramRoute() {
  const { repo, reader, openNoteEditor } = useApp();
  const readWithWords = useReadWithWords();
  const { id } = useLocalSearchParams<{ id: string }>();
  const queue = useNoteQueue(reader.api);
  const review = useReviewQueued(queue.add);
  // Read a text waits on a sync and the server: once this page is out of sight (Back, or another tab), the reader doesn't open.
  const here = useRef(false);
  useFocusEffect(useCallback(() => { here.current = true; return () => { here.current = false; }; }, []));
  return (
    <CramPage
      repo={repo}
      id={id}
      readerApi={reader.api}
      serverRegister={reader.settings?.register}
      queued={queue.queue?.items}
      // Saving in the note editor is the approval, and the note leaves the queue once it's saved.
      approve={reader.api ? async (note) => {
        if (!(await review(note))) return false;
        await queue.remove(note.id);
        return true;
      } : undefined}
      retry={reader.api ? queue.retry : undefined}
      onEditNote={(noteId, onClose) => openNoteEditor({ noteId }, () => onClose())}
      onRead={(language, words, own) => { readWithWords(language, words, () => here.current, own); }}
    />
  );
}
