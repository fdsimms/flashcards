import { useCallback } from 'react';
import { Alert } from 'react-native';
import { failureText } from '../core/failure';
import type { GlossLanguage, QueuedNote, QueueEntry } from '../reader/api';
import { reviewTarget } from '../reader/noteQueue';
import { useApp } from './AppContext';
import { useLineClip } from './useLineClip';

/**
 * Opens a ready queued note in the note editor, resolving true once it's saved. Saving there is the
 * approval: the note is only added if it's saved. A word that could be more than one is answered in
 * the editor too: another word is queued in its place (`add`; true takes this one off the queue), or
 * none was meant. Shared by the queue screen and a cram's Add, so both approve the same way.
 */
export function useReviewQueued(add: (language: GlossLanguage, deck: string, entries: QueueEntry[]) => Promise<unknown>) {
  const { openNoteEditor } = useApp();
  const clip = useLineClip();
  return useCallback(async (note: QueuedNote) => {
    const target = await clip.note(reviewTarget(note), note.heard);
    return new Promise<boolean>((resolve) => openNoteEditor(target, (result) => {
      if (result && 'chose' in result) {
        // The word meant is queued in its place, still heard where this one was.
        add(note.language, note.deck, [{ ...result.chose, ...(note.heard ? { heard: note.heard } : {}) }]).then(() => resolve(true), (e: unknown) => {
          Alert.alert(`Couldn't add ${result.chose.entry} to the queue`, failureText(e, { next: `${note.entry} is still queued, so open it to try again.` }));
          resolve(false);
        });
        return;
      }
      if (result && 'saved' in result && result.saved) clip.keep(result.saved, note.heard);
      resolve(!!result && ('saved' in result || 'dropped' in result));
    }));
  }, [add, openNoteEditor, clip]);
}
