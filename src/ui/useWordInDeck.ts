import { useCallback, useMemo } from 'react';
import { notesStillThere } from '../core/noteEditing';
import type { NoteStore } from '../anki/noteService';
import { wordInDeck } from '../reader/noteQueue';
import { useCollection } from './useCrams';

/**
 * Whether a word a screen offers to send to the note queue is already in `deck` (`wordInDeck`, the check
 * the save would refuse it by), for Practice and the crams' "add this word" rows. Their dotted words are
 * the ones not yet studied, which includes a word the deck has as a new card. Read again each time the
 * screen comes into view (`useCollection`); false until the collection has been read.
 */
export function useWordInDeck(repo: Pick<NoteStore, 'listNotes' | 'listCards'>): (deck: string | undefined, word: string) => boolean {
  const { notes, cards } = useCollection(repo);
  const live = useMemo(() => notesStillThere(notes, cards), [notes, cards]);
  return useCallback((deck, word) => !!deck && wordInDeck(live, deck, word) !== undefined, [live]);
}
