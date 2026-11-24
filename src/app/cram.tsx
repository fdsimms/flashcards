import { useLocalSearchParams } from 'expo-router';
import React from 'react';
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
      onRead={(language, words, topic) => { readWithWords(language, words, undefined, topic); }}
    />
  );
}
