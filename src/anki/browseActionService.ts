import { bulkSummary, cardsOfNotes, notesAfter, repositionPositions, type BulkAction } from '../core/browseActions';
import type { CardState } from '../core/cardState';
import { Refusal } from '../core/failure';
import type { Card, Note } from '../core/types';
import { moveAnkiNotesUndoable, repositionAnkiCards, setAnkiNoteTags } from './bulkWrites';
import { readCardRows, setCardStatesUndoable, undoAnkiAction, type AnkiActionUndo } from './cardUndo';
import { ankiDeckId } from './noteWrites';
import type { NoteStore } from './noteService';
import { forgetCards, setDueDates } from './rescheduleService';

/**
 * Browse's Select mode (src/core/browseActions.ts): an action on the notes picked, in the kept Anki
 * collection as Anki writes it and in Franki's tables, and Undo for the latest one. Undo puts the
 * collection's rows back (`undoAnkiAction`, refused once a sync has sent them) and Franki's notes and
 * cards as they were before.
 */

/** Why an action can't be done, with what to do, to show as it is. */
export class BulkRefused extends Refusal {}

/** What undoes an action: the collection's rows, and Franki's notes and cards, as they were. */
export interface BulkUndo {
  anki?: AnkiActionUndo;
  notes: Note[];
  cards: Card[];
}

export interface BulkResult {
  /** What it did, as the bar says it. */
  summary: string;
  undo: BulkUndo;
  /** The collection didn't take it, though Franki did (it was busy, or the change failed there). */
  ankiError?: unknown;
}

const stateChange = (a: BulkAction): ((s: CardState) => CardState) | undefined => {
  switch (a.kind) {
    case 'suspend': return (s) => ({ ...s, suspended: true });
    case 'unsuspend': return (s) => ({ ...s, suspended: false });
    case 'bury': return (s) => ({ ...s, buried: true });
    case 'flag': return (s) => ({ ...s, flag: a.flag });
    default: return undefined;
  }
};

/** The Anki note ids of Franki's notes, through their cards' Anki ids. */
async function ankiNoteIds(store: NoteStore, cards: Card[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const withAnki = cards.filter((c) => c.ankiId);
  if (!withAnki.length || !(await store.keptCollection())) return out;
  const rows = await store.withSyncConnection((db) => readCardRows(db, withAnki.map((c) => Number(c.ankiId))));
  const known = new Set(rows.map((r) => r.cid));
  await store.withSyncConnection(async (db) => {
    for (const c of withAnki) {
      if (out.has(c.noteId) || !known.has(Number(c.ankiId))) continue;
      const r = await db.first<{ nid: number }>('SELECT nid FROM cards WHERE id = ?', Number(c.ankiId));
      if (r) out.set(c.noteId, Number(r.nid));
    }
  });
  return out;
}

/** Does `action` to the notes picked, in Browse's order. */
export async function runBulkAction(
  store: NoteStore, noteIds: string[], action: BulkAction, ctx: { now: Date; dayStartsAtHour: number; random?: () => number },
): Promise<BulkResult> {
  const { now } = ctx;
  const allNotes = new Map((await store.listNotes()).map((n) => [n.id, n]));
  const notes = noteIds.map((id) => allNotes.get(id)).filter((n): n is Note => !!n);
  const cards = cardsOfNotes(notes.map((n) => n.id), await store.listCards());
  const kept = !!(await store.keptCollection());

  const change = stateChange(action);
  if (change) {
    const { cards: after, anki, ankiError } = await setCardStatesUndoable(store, cards, change, now, ctx.dayStartsAtHour);
    return { summary: bulkSummary(action, after.length, notes.length), undo: { anki, notes: [], cards }, ankiError };
  }

  if (action.kind === 'dueDate' || action.kind === 'forget') {
    // Set Due Date and Forget as Review's menu does them, on every card at once.
    const r = action.kind === 'dueDate'
      ? await setDueDates(store, cards, action.spec, now, ctx.random)
      : await forgetCards(store, cards, { resetCounts: action.resetCounts }, now);
    return { summary: bulkSummary(action, r.cards.length, notes.length), undo: { anki: r.anki, notes: [], cards } };
  }

  if (action.kind === 'reposition') {
    const fresh = cards.filter((c) => c.sched.state === 0);
    if (!fresh.length) throw new BulkRefused('None of these notes has a new card to reposition.');
    const inAnki = kept ? fresh.filter((c) => c.ankiId) : [];
    let anki: AnkiActionUndo | undefined;
    const positions = new Map<string, number>();
    if (inAnki.length) {
      const r = await store.lockAnki(() => store.withSyncConnection((db) => repositionAnkiCards(db, inAnki.map((c) => Number(c.ankiId)), action, now, ctx.random)));
      anki = r.undo;
      // Every card it moved, those it shifted along too, by Franki's id.
      for (const c of await store.listCards()) {
        const p = c.ankiId ? r.positions.get(Number(c.ankiId)) : undefined;
        if (p !== undefined) positions.set(c.id, p);
      }
    }
    // A card Anki doesn't have takes a place the same way, among Franki's own.
    const own = fresh.filter((c) => !inAnki.includes(c));
    const ownPositions = repositionPositions(own.map((c) => c.noteId), action.start, action.step, action.randomize, ctx.random);
    for (const c of own) positions.set(c.id, ownPositions.get(c.noteId)!);
    const all = await store.listCards();
    const before = all.filter((c) => positions.has(c.id));
    for (const c of before) await store.saveCard({ ...c, position: positions.get(c.id) });
    return { summary: bulkSummary(action, fresh.length, notes.length), undo: { anki, notes: [], cards: before } };
  }

  // A change of deck or tags: the notes it changes.
  const changed = notesAfter(notes, action);
  if (!changed.length) {
    return { summary: action.kind === 'deck' ? `These notes are in ${action.deck} already.` : action.kind === 'addTags' ? 'These notes have those tags already.' : 'None of these notes has those tags.', undo: { notes: [], cards: [] } };
  }
  const changedIds = new Set(changed.map((n) => n.id));
  const changedCards = cards.filter((c) => changedIds.has(c.noteId));
  const nids = kept ? await ankiNoteIds(store, changedCards) : new Map<string, number>();
  let anki: AnkiActionUndo | undefined;
  if (action.kind === 'deck') {
    if (nids.size) {
      anki = await store.lockAnki(() => store.withSyncConnection(async (db) => {
        const deckId = await ankiDeckId(db, action.deck);
        if (deckId === null) throw new BulkRefused(`The Anki collection has no deck called "${action.deck}". Sync, then try again.`);
        return moveAnkiNotesUndoable(db, [...nids.values()], deckId, now);
      }));
    }
  } else if (nids.size) {
    const tagsOf = new Map(changed.filter((n) => nids.has(n.id)).map((n) => [nids.get(n.id)!, n.tags]));
    anki = await store.lockAnki(() => store.withSyncConnection((db) => setAnkiNoteTags(db, tagsOf, now)));
  }
  // Franki's copy: the notes, and for a move every card of theirs at home in the new deck, as saveNote moves one.
  const allCards = await store.listCards();
  const theirCards = allCards.filter((c) => changedIds.has(c.noteId));
  const moved = action.kind === 'deck'
    ? theirCards.map((c) => ({ ...c, deck: undefined, filteredDeck: undefined, filteredDue: undefined, previewDue: undefined }))
    : theirCards;
  await store.upsertNotesAndCards(changed, moved);
  if (action.kind === 'deck') for (const c of moved.filter((m) => m.retired)) await store.saveCard(c);
  return {
    summary: bulkSummary(action, theirCards.filter((c) => !c.retired).length, changed.length),
    undo: { anki, notes: notes.filter((n) => changedIds.has(n.id)), cards: theirCards },
  };
}

/**
 * Takes the latest action back: out of the collection first (false, changing nothing, once a sync
 * has sent it), then Franki's notes and cards as they were.
 */
export async function undoBulkAction(store: NoteStore, undo: BulkUndo, now: Date = new Date()): Promise<boolean> {
  if (undo.anki && (await store.keptCollection())) {
    const done = await store.lockAnki(() => store.withSyncConnection((db) => undoAnkiAction(db, undo.anki!, now)));
    if (!done) return false;
  }
  if (undo.notes.length) {
    const ids = new Set(undo.notes.map((n) => n.id));
    const current = (await store.listCards()).filter((c) => ids.has(c.noteId));
    // Every card of each note goes with it, so the upsert retires none; the cards are put back below.
    await store.upsertNotesAndCards(undo.notes, current.filter((c) => !c.retired));
  }
  for (const c of undo.cards) await store.saveCard(c);
  return true;
}
