import { Refusal } from '../core/failure';
import { cardRequirements, notesGainingCards, templateProblems } from '../core/noteTypeEdits';
import type { NoteType } from '../core/types';
import { ordOf, type NoteStore } from './noteService';
import { setAnkiNoteTypeLook } from './notetypeWrites';

/**
 * Changing a note type's card templates and styling (the Note type screen): checked as Anki checks
 * them, written into the kept Anki collection when there is one (so sync carries the change, with
 * no full upload), then into Franki's own copy, which renders the cards.
 */

/** Why a note type's change wasn't saved, with what to do, to show as it is. */
export class NoteTypeRefused extends Refusal {}

export interface NoteTypeChange {
  /** Each card type's front and back, by ordinal; a card type left out keeps its own. */
  templates: { ord: number; front: string; back: string }[];
  css: string;
}

export async function saveNoteTypeLook(store: NoteStore, name: string, change: NoteTypeChange, now: Date = new Date()): Promise<NoteType> {
  const current = (await store.listNoteTypes()).get(name);
  if (!current) throw new NoteTypeRefused(`Franki has no note type called ${name} anymore. Sync, then try again.`);
  const byOrd = new Map(change.templates.map((t) => [t.ord, t]));
  const updated: NoteType = {
    ...current,
    css: change.css,
    templates: current.templates.map((t) => {
      const c = byOrd.get(t.ord);
      return c ? { ...t, front: c.front, back: c.back } : t;
    }),
  };
  const problem = templateProblems(updated)[0];
  if (problem) throw new NoteTypeRefused(problem.message);

  const [notes, cards] = await Promise.all([store.listNotes(), store.listCards()]);
  const ords = new Map<string, Set<number>>();
  const byNote = new Map(notes.map((n) => [n.id, n]));
  for (const c of cards) {
    const note = byNote.get(c.noteId);
    if (!note || note.model !== name) continue;
    if (!ords.has(note.id)) ords.set(note.id, new Set());
    ords.get(note.id)!.add(ordOf(note, c.kind));
  }
  const gaining = notesGainingCards(notes, updated, (n) => ords.get(n.id) ?? new Set());
  if (gaining) {
    throw new NoteTypeRefused(`This change would give ${gaining === 1 ? '1 note a card it doesn\'t' : `${gaining} notes a card they don't`} have yet. Franki can't add those cards, so make this change in Anki.`);
  }

  if (await store.keptCollection()) {
    const result = await store.lockAnki(() => store.withSyncConnection((db) =>
      setAnkiNoteTypeLook(db, name, { templates: updated.templates, css: updated.css, reqs: cardRequirements(updated) }, now)));
    if (result === 'noCollation') throw new NoteTypeRefused("This build of Franki can't change note types in your Anki collection. Rebuild the app, or make the change in Anki and sync.");
    if (result === 'missing') throw new NoteTypeRefused(`Your Anki collection has no note type called ${name}, so the change wasn't saved. Sync, then try again.`);
    if (result === 'changed') throw new NoteTypeRefused(`${name} has different card types in your Anki collection, so the change wasn't saved. Sync, then try again.`);
  }
  await store.saveNoteTypes([updated]);
  return updated;
}
