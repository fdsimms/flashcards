import { useCallback } from 'react';
import { Alert } from 'react-native';
import { failureText } from '../core/failure';
import type { Language, QueuedNote } from '../reader/api';
import { reviewTarget } from '../reader/noteQueue';
import { useApp } from './AppContext';

/**
 * Opens a ready queued note in the note editor, resolving true once it's saved. Saving there is the
 * approval: the note is only added if it's saved. A word that could be more than one is answered in
 * the editor too: another word is queued in its place (`add`; true takes this one off the queue), or
 * none was meant. Shared by the queue screen and a cram's Add, so both approve the same way.
 */
export function useReviewQueued(add: (language: Language, deck: string, entries: { entry: string; meaning: string }[]) => Promise<unknown>) {
  const { openNoteEditor } = useApp();
  return useCallback((note: QueuedNote) => new Promise<boolean>((resolve) => openNoteEditor(reviewTarget(note), (result) => {
    if (result && 'chose' in result) {
      add(note.language, note.deck, [result.chose]).then(() => resolve(true), (e: unknown) => {
        Alert.alert(`Couldn't add ${result.chose.entry} to the queue`, failureText(e, { next: `${note.entry} is still queued, so open it to try again.` }));
        resolve(false);
      });
      return;
    }
    resolve(!!result && ('saved' in result || 'dropped' in result));
  })), [add, openNoteEditor]);
}
