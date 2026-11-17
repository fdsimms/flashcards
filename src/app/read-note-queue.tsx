import { Redirect } from 'expo-router';
import React from 'react';
import { dropWord } from '../reader/heldNotes';
import { reviewTarget } from '../reader/noteQueue';
import { noteQueueStore } from '../reader/noteQueueStore';
import { useApp } from '../ui/AppContext';
import { ReadNoteQueue } from '../ui/reader/ReadNoteQueue';
import { heldWords, useHeldWords } from '../ui/held';
import { useNoteQueue } from '../ui/useNoteQueue';

/** The queued notes, opened from the deck list's card: review what Claude filled in, one note at a time. */
export default function ReadNoteQueueRoute() {
  const { reader, openNoteEditor } = useApp();
  const { queue, error, refresh, retry, remove } = useNoteQueue(reader.api);
  const held = useHeldWords();
  if (!reader.api) return <Redirect href="/read-settings" />;
  return (
    <ReadNoteQueue
      queue={queue}
      error={error}
      held={held}
      onRemoveHeld={(deck, entry) => { void heldWords.update((list) => dropWord(list, deck, entry)); }}
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
