import { Redirect } from 'expo-router';
import React, { useEffect } from 'react';
import { dropWord } from '../reader/heldNotes';
import { noteQueueStore } from '../reader/noteQueueStore';
import { useApp } from '../ui/AppContext';
import { ReadNoteQueue } from '../ui/reader/ReadNoteQueue';
import { heldWords, useHeldWords } from '../ui/held';
import { useApproveQueued } from '../ui/useApproveQueued';
import { useNoteQueue } from '../ui/useNoteQueue';
import { useReviewQueued } from '../ui/useReviewQueued';

/** The queued notes, opened from the deck list's card: review what Claude filled in, one note at a time. */
export default function ReadNoteQueueRoute() {
  const { reader } = useApp();
  const { queue, error, dropped, clearDropped, refresh, retry, remove, add } = useNoteQueue(reader.api);
  const onReview = useReviewQueued(add);
  const held = useHeldWords();
  const approveAll = useApproveQueued(remove);
  // The words taken off as duplicates are said once, on this screen, and forgotten when it's left.
  useEffect(() => clearDropped, [clearDropped]);
  if (!reader.api) return <Redirect href="/read-settings" />;
  return (
    <ReadNoteQueue
      queue={queue}
      error={error}
      dropped={dropped}
      held={held}
      onRemoveHeld={(deck, entry) => { void heldWords.update((list) => dropWord(list, deck, entry)); }}
      getItems={() => noteQueueStore.get().queue?.items ?? []}
      onReview={onReview}
      onApproveAll={approveAll}
      onRetry={retry}
      onRemove={remove}
      onRefresh={refresh}
    />
  );
}
