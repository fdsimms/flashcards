import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type MutableRefObject } from 'react';
import { Alert } from 'react-native';
import { saveNote, type NoteStore } from '../anki/noteService';
import { cardHomeDeck, untiered } from '../core/deckTree';
import { failureText, Refusal } from '../core/failure';
import { notesStillThere } from '../core/noteEditing';
import { SENSE_CONTRAST_FIELD, contrastRows, contrastWords, withoutContrastWord, type ContrastRow } from '../core/senseContrast';
import type { Card, Note } from '../core/types';
import { reviewWrites } from '../core/writeQueue';
import type { Repo } from '../db/repo';
import type { Language } from '../reader/api';
import { cardLanguage } from '../reader/cardGlosses';
import { noteQueueStore } from '../reader/noteQueueStore';
import { haptic } from './haptics';
import { useHoldOffer } from './HoldUndo';
import type { ContrastActions } from './SenseContrastBox';
import type { AddWord } from './useAddMinedWord';

/**
 * What the "not this word" box under an answer's Sense does (src/core/senseContrast.ts), for the
 * card on screen. Add sends the word the way every Add to deck does (`useAddMinedWord`: the note
 * queue while Read & Listen is on, else the note editor). The x takes the word out of the note's
 * SenseContrast field through `saveNote`, so Anki and sync carry it, and offers Undo for a few
 * seconds. Nothing here touches a card or a schedule.
 *
 * `writes` is Review's write counter, as `useFieldEdit` uses it. `decks` are Read & Listen's
 * language decks, when it's signed in.
 */
export function useSenseContrast({ repo, writes, card, note, decks, addWord, onOpenNote, onSaved }: {
  repo: Repo; writes: MutableRefObject<number>; card: Card | undefined; note: Note | undefined;
  decks: Partial<Record<Language, string>> | undefined;
  addWord: ((add: AddWord) => Promise<boolean>) | undefined;
  /** Opens a note in the editor; `closed` runs once it has been saved or deleted there. */
  onOpenNote: (noteId: string, closed: () => void) => void;
  onSaved: (note: Note) => void;
}) {
  const field = note?.fields[SENSE_CONTRAST_FIELD] ?? '';
  const has = contrastWords(field).length > 0;
  // Every note still in the collection, to see which words are cards already. Read when a card with
  // the box comes up, and again after a word is added or a note is opened from it.
  const [all, setAll] = useState<{ forNote: string; notes: Note[] } | null>(null);
  const [reads, setReads] = useState(0);
  const noteId = note?.id;
  useEffect(() => {
    if (!has || !noteId) return;
    let live = true;
    Promise.all([repo.listNotes(), repo.listCards()])
      .then(([notes, cards]) => { if (live) setAll({ forNote: noteId, notes: notesStillThere(notes, cards) }); })
      .catch(() => {}); // Only what the rows offer: the pairs still show as text.
    return () => { live = false; };
  }, [repo, has, noteId, reads]);

  // Words added since the screen opened: the editor's saves show up in `all`, the queue's in the store,
  // and this covers the moment before either does.
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
  const queue = useSyncExternalStore(noteQueueStore.subscribe, noteQueueStore.get).queue;
  const rows = useMemo(
    () => (note && has && all?.forNote === note.id ? contrastRows(note, all.notes, [...(queue?.items.map((n) => n.entry) ?? []), ...added]) : []),
    [note, has, all, queue, added],
  );

  const busy = useRef(false);
  const hold = useHoldOffer();
  const removed = useRef<{ noteId: string; before: string } | null>(null);

  const write = useCallback(async (id: string, change: (fields: Record<string, string>) => Record<string, string>) => {
    writes.current++;
    try {
      // The answer's own writes finish first, then the note as it is now (as useFieldEdit does).
      await reviewWrites.idle();
      const now = await repo.getNote(id);
      if (!now) throw new Refusal("This note isn't in Franki anymore. Go back to the deck and open the card again.");
      const fields = change(now.fields);
      if (fields === now.fields) return;
      onSaved(await saveNote(repo as NoteStore, { id: now.id, deck: now.deck, model: now.model, fields, tags: now.tags }));
    } finally {
      writes.current++;
    }
  }, [repo, writes, onSaved]);

  const onAdd = useCallback(async (row: ContrastRow) => {
    if (busy.current || !addWord || !card || !note) return;
    busy.current = true;
    try {
      const language = decks ? cardLanguage(card, note, decks) : null;
      const deck = (language && decks?.[language]) || untiered(cardHomeDeck(card, note.deck));
      if (await addWord({ word: row.word, meaning: row.sense, deck, language: language ?? undefined })) {
        setAdded((prev) => new Set(prev).add(row.word));
        setReads((n) => n + 1);
      }
    } catch (e) {
      Alert.alert(`Couldn't add ${row.word}`, failureText(e, { next: 'Try again.' }));
    } finally {
      busy.current = false;
    }
  }, [addWord, card, note, decks]);

  const onRemove = useCallback(async (row: ContrastRow) => {
    if (busy.current || !note) return;
    busy.current = true;
    const id = note.id;
    try {
      const was: { before?: string } = {};
      await write(id, (fields) => {
        const next = withoutContrastWord(fields, row);
        if (next !== fields) was.before = fields[SENSE_CONTRAST_FIELD];
        return next;
      });
      if (was.before === undefined) return;
      removed.current = { noteId: id, before: was.before };
      haptic.select();
      hold.show({ label: `Removed ${row.word} from this card` });
    } catch (e) {
      Alert.alert(`Couldn't remove ${row.word}`, failureText(e, { next: 'Try again.' }));
    } finally {
      busy.current = false;
    }
  }, [note, write, hold.show]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Puts back the field as it was before the last removal. */
  const undo = useCallback(async () => {
    const last = removed.current;
    removed.current = null;
    hold.show(null);
    if (!last || busy.current) return;
    busy.current = true;
    try {
      await write(last.noteId, (fields) => ({ ...fields, [SENSE_CONTRAST_FIELD]: last.before }));
    } catch (e) {
      Alert.alert("Couldn't put the word back", failureText(e, { next: "Add it again in the note's SenseContrast field." }));
    } finally {
      busy.current = false;
    }
  }, [write, hold.show]); // eslint-disable-line react-hooks/exhaustive-deps

  const onOpen = useCallback((id: string) => onOpenNote(id, () => setReads((n) => n + 1)), [onOpenNote]);
  const actions = useMemo<ContrastActions | undefined>(
    () => (addWord && rows.length ? { rows, onAdd, onRemove, onOpen } : undefined),
    [addWord, rows, onAdd, onRemove, onOpen],
  );
  return { actions, offer: hold.offer, undo };
}
