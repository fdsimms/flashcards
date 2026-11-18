import { useCallback, useState, type MutableRefObject } from 'react';
import { saveNote, type NoteStore } from '../anki/noteService';
import { withFieldText, type EditableField } from '../core/editField';
import { Refusal } from '../core/failure';
import { reviewWrites } from '../core/writeQueue';
import type { Note } from '../core/types';
import type { Repo } from '../db/repo';

/**
 * Editing a card's Mnemonic or Notes in place (EditableField): saves the note, and says while a box
 * is open (`editing`), so Review holds off swipe-to-rate. `writes` is Review's write counter, so a
 * load that began before the save reads again instead of putting the old note back.
 */
export function useFieldEdit(repo: Repo, writes: MutableRefObject<number>, onSaved: (note: Note) => void) {
  const [editing, setEditing] = useState(false);
  const save = useCallback(async (noteId: string, field: EditableField, text: string) => {
    writes.current++;
    try {
      // The answer's own writes finish first, then the note as it is now: the answer may have changed it (a tag).
      await reviewWrites.idle();
      const now = await repo.getNote(noteId);
      if (!now) throw new Refusal("This note isn't in Franki anymore. Go back to the deck and open the card again.");
      const fields = withFieldText(now.fields, field, text);
      if (fields === now.fields) return;
      onSaved(await saveNote(repo as NoteStore, { id: now.id, deck: now.deck, model: now.model, fields, tags: now.tags }));
    } finally {
      writes.current++;
    }
  }, [repo, writes, onSaved]);
  return { editing, setEditing, save };
}
