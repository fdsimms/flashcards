import { Redirect } from 'expo-router';
import React from 'react';
import { Alert } from 'react-native';
import { failureText } from '../core/failure';
import { dropWord } from '../reader/heldNotes';
import { reviewTarget } from '../reader/noteQueue';
import { noteQueueStore } from '../reader/noteQueueStore';
import { useApp } from '../ui/AppContext';
import { ReadNoteQueue } from '../ui/reader/ReadNoteQueue';
import { heldWords, useHeldWords } from '../ui/held';
import { useApproveQueued } from '../ui/useApproveQueued';
import { useNoteQueue } from '../ui/useNoteQueue';

/** The queued notes, opened from the deck list's card: review what Claude filled in, one note at a time. */
export default function ReadNoteQueueRoute() {
  const { reader, openNoteEditor } = useApp();
  const { queue, error, refresh, retry, remove, add } = useNoteQueue(reader.api);
  const held = useHeldWords();
  const approveAll = useApproveQueued(remove);
  if (!reader.api) return <Redirect href="/read-settings" />;
  return (
    <ReadNoteQueue
      queue={queue}
      error={error}
      held={held}
      onRemoveHeld={(deck, entry) => { void heldWords.update((list) => dropWord(list, deck, entry)); }}
      getItems={() => noteQueueStore.get().queue?.items ?? []}
      // Saving in the note editor is the approval: the note is only added if it's saved there. A word
      // that could be more than one is answered there too: another word is queued in its place
      // (true takes this one off the queue), or none was meant.
      onReview={(note) => new Promise<boolean>((resolve) => openNoteEditor(reviewTarget(note), (result) => {
        if (result && 'chose' in result) {
          add(note.language, note.deck, [result.chose]).then(() => resolve(true), (e: unknown) => {
            Alert.alert(`Couldn't add ${result.chose.entry} to the queue`, failureText(e, { next: `${note.entry} is still queued, so open it to try again.` }));
            resolve(false);
          });
          return;
        }
        resolve(!!result && ('saved' in result || 'dropped' in result));
      }))}
      onApproveAll={approveAll}
      onRetry={retry}
      onRemove={remove}
      onRefresh={refresh}
    />
  );
}
