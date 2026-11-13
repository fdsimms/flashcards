import { Redirect } from 'expo-router';
import React from 'react';
import { reviewTarget } from '../reader/noteQueue';
import { noteQueueStore } from '../reader/noteQueueStore';
import { useApp } from '../ui/AppContext';
import { ReadNoteQueue } from '../ui/ReadNoteQueue';
import { useNoteQueue } from '../ui/useNoteQueue';

/** The queued notes, opened from the deck list's card: review what Claude filled in, one note at a time. */
export default function ReadNoteQueueRoute() {
  const { reader, openNoteEditor } = useApp();
  const { queue, error, refresh, retry, remove } = useNoteQueue(reader.api);
  if (!reader.api) return <Redirect href="/read-settings" />;
  return (
    <ReadNoteQueue
      queue={queue}
      error={error}
      getItems={() => noteQueueStore.get().queue?.items ?? []}
      // Saving in the note editor is the approval: the note is only added if it's saved there.
      onReview={(note) => new Promise<boolean>((resolve) => openNoteEditor(reviewTarget(note), (result) => {
        resolve(!!result && 'saved' in result);
      }))}
      onRetry={retry}
      onRemove={remove}
      onRefresh={refresh}
    />
  );
}
