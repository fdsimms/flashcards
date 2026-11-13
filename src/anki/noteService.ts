import { isOmnilanguage, makeCards } from '../core/cards';
import { cardStateOf, withCardState, type CardState } from '../core/cardState';
import type { Card, Note, NoteType } from '../core/types';
import type { AnkiLink } from '../db/ankiLink';
import { ankiCollapsedDecks, setAnkiDeckCollapsed } from './deckWrites';
import type { Repo } from '../db/repo';
import { omnilanguageKindByOrd } from '../import/models';
import { addAnkiNote, ankiDeckId, ankiNoteType, deleteAnkiNotes, editAnkiNote, moveAnkiNote } from './noteWrites';
import type { SyncDb } from './sync/collectionSync';

/**
 * Adding, editing and deleting a note: in the kept Anki collection when the note is Anki's (so
 * Send to Anki and sync carry the change back), and in Franki's own tables either way. A note in
 * a deck the Anki collection doesn't have (a TSV import's) lives in Franki only.
 *
 * Cards follow Anki's rules: a note gets a card for each template whose front shows something
 * (`makeCards`); an edit adds any card the note now generates, and keeps the rest, studied or not,
 * with their schedules. A card it no longer generates is retired in Franki and stays in Anki, as
 * Anki keeps one (its "empty cards").
 */

/** What the note service needs: Franki's tables, and the kept collection when there is one. */
export interface NoteStore extends Repo {
  keptCollection(): Promise<unknown | null>;
  lockAnki<T>(fn: () => Promise<T>): Promise<T>;
  withSyncConnection<T>(fn: (db: SyncDb) => Promise<T>): Promise<T>;
}

export interface NoteDraft {
  /** Absent when adding. */
  id?: string;
  deck: string;
  model: string;
  fields: Record<string, string>;
  tags: string[];
}

/** A note that can't be saved, with the reason to show beside it. */
export class NoteRefused extends Error {}

/** The cards a note would have (new ones), the way Franki generates them. */
export function cardsFor(note: Note, noteTypes: Map<string, NoteType>, now: Date): Card[] {
  return makeCards(note, now, isOmnilanguage(note) ? undefined : noteTypes.get(note.model));
}

/** The Anki template ordinal a Franki card kind stands for. */
function ordOf(note: Note, kind: Card['kind']): number {
  if (isOmnilanguage(note)) return omnilanguageKindByOrd.indexOf(kind as (typeof omnilanguageKindByOrd)[number]);
  return kind.startsWith('t') ? Number(kind.slice(1)) : 0;
}

function frankiNoteId(now: Date): string {
  return `franki:${now.getTime().toString(36)}${Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, '0')}`;
}

export async function saveNote(store: NoteStore, draft: NoteDraft, now: Date = new Date()): Promise<Note> {
  const noteTypes = await store.listNoteTypes();
  const noteType = noteTypes.get(draft.model);
  const existing = draft.id ? await store.getNote(draft.id) : undefined;
  if (draft.id && !existing) throw new NoteRefused("This note isn't in Franki any more.");
  // An edit can move the note to another deck; it can't change its note type.
  const note: Note = { id: draft.id ?? '', deck: draft.deck, model: existing?.model ?? draft.model, fields: draft.fields, tags: draft.tags };
  const generated = cardsFor(note, noteTypes, now);
  if (!generated.length) {
    throw new NoteRefused(isOmnilanguage(note)
      ? 'This note makes no cards. Fill in Entry, or turn off SuppressFrontCard.'
      : 'This note makes no cards: every card type\'s front would be blank. Fill in the field its front shows.');
  }

  const oldCards = existing ? (await store.listCards(existing.deck)).filter((c) => c.noteId === existing.id) : [];
  const ords = generated.map((c) => ordOf(note, c.kind)).filter((o) => o >= 0);
  const fieldOrder = noteType?.fields.length ? noteType.fields : Object.keys(draft.fields);
  let ankiIds = new Map<number, string>();

  if (await store.keptCollection()) {
    const isAnkiNote = existing ? oldCards.some((c) => c.ankiId) : true;
    if (isAnkiNote) {
      const result = await store.lockAnki(() => store.withSyncConnection(async (db) => {
        const nt = await ankiNoteType(db, note.model, fieldOrder);
        if (!nt) return null;
        if (existing) {
          const nid = await ankiNoteIdOf(db, oldCards);
          if (nid === null) return { refused: "This note's cards aren't in the Anki collection any more, so it can't be changed there. Sync, then try again." };
          // Moved first, so a card the edit adds lands in the new deck.
          if (note.deck !== existing.deck) {
            const deckId = await ankiDeckId(db, note.deck);
            if (deckId === null) return { refused: `The Anki collection has no deck called "${note.deck}", so the note can't move there.` };
            await moveAnkiNote(db, nid, deckId, now);
          }
          const added = await editAnkiNote(db, { nid, noteType: nt, fields: note.fields, tags: note.tags, ords, now });
          return { nid, added };
        }
        const deckId = await ankiDeckId(db, note.deck);
        if (deckId === null) return null;
        const r = await addAnkiNote(db, { noteType: nt, deckId, fields: note.fields, tags: note.tags, ords, now });
        return { nid: r.nid, added: r.cards };
      }));
      if (result && 'refused' in result) throw new NoteRefused(result.refused);
      if (result) {
        if (!existing) note.id = String(result.nid);
        ankiIds = new Map(result.added.map((c) => [c.ord, String(c.id)]));
      } else if (existing) {
        throw new NoteRefused(`The Anki collection has no note type called "${note.model}", so this note can't be changed there.`);
      }
    }
  }
  if (!note.id) note.id = frankiNoteId(now);

  // Keep every card the note already has as it is (schedule, suspension, its Anki card); a new one
  // takes the Anki card just made for it.
  const byId = new Map(oldCards.map((c) => [c.id, c]));
  const cards = cardsFor(note, noteTypes, now).map((c) => {
    const old = byId.get(c.id);
    // Moving the note moves every card of it, as in Anki, so none keeps a deck of its own.
    if (old) return { ...old, retired: false, ...(existing && note.deck !== existing.deck ? { deck: undefined } : {}) };
    const ankiId = ankiIds.get(ordOf(note, c.kind));
    return ankiId ? { ...c, ankiId } : c;
  });
  await store.upsertNotesAndCards([note], cards);
  return note;
}

/**
 * The Anki note a Franki note is, found through its cards' Anki ids. Usually the same number as
 * Franki's id, but not always: a note an import matched to one already here (`reconcileIds`, a
 * TSV note later found in the collection) keeps the id Franki gave it.
 */
async function ankiNoteIdOf(db: SyncDb, cards: Card[]): Promise<number | null> {
  for (const c of cards) {
    if (!c.ankiId) continue;
    const row = await db.first<{ nid: number }>('SELECT nid FROM cards WHERE id = ?', Number(c.ankiId));
    if (row) return row.nid;
  }
  return null;
}

export async function deleteNote(store: NoteStore, noteId: string, now: Date = new Date()): Promise<void> {
  const note = await store.getNote(noteId);
  if (!note) return;
  const cards = (await store.listCards(note.deck)).filter((c) => c.noteId === noteId);
  if (cards.some((c) => c.ankiId) && (await store.keptCollection())) {
    await store.lockAnki(() => store.withSyncConnection(async (db) => {
      const nid = await ankiNoteIdOf(db, cards);
      // None of its cards left in Anki: the note is already gone there.
      if (nid !== null) await deleteAnkiNotes(db, [nid], now);
    }));
  }
  await store.deleteNote(noteId);
}

/**
 * Suspends, buries or flags cards: in Franki's tables first, then in the kept collection as Anki
 * writes it (`setAnkiCardStates`), so sync and Send to Anki carry it. The cards come back as saved;
 * `ankiError` says why the collection didn't take the change, which stays made in Franki.
 */
export async function setCardStates(
  store: Pick<Repo, 'saveCard'> & Pick<AnkiLink, 'setAnkiCardStates'>,
  targets: Card[], change: (s: CardState) => CardState, now: Date, dayStartsAtHour: number,
): Promise<{ cards: Card[]; ankiError?: unknown }> {
  const cards = targets.map((t) => withCardState(t, change(cardStateOf(t, now, dayStartsAtHour)), now));
  for (const c of cards) await store.saveCard(c);
  try {
    await store.setAnkiCardStates(cards.filter((c) => c.ankiId).map((c) => ({ ankiId: c.ankiId!, state: cardStateOf(c, now, dayStartsAtHour) })), now);
  } catch (e) {
    return { cards, ankiError: e };
  }
  return { cards };
}

/**
 * The decks collapsed on the deck list: Anki's own flag for each deck in the kept collection
 * (`ankiCollapsedDecks`), else Franki's for a deck Anki doesn't have. Waits while a sync holds the
 * collection, so the deck list loads this on its own.
 */
export async function collapsedDecks(store: NoteStore): Promise<Set<string>> {
  const local = [...(await store.listDeckSettings())].filter(([, s]) => s.collapsed).map(([d]) => d);
  const anki = (await store.keptCollection()) ? await store.lockAnki(() => store.withSyncConnection(ankiCollapsedDecks)) : new Set<string>();
  return new Set([...anki, ...local]);
}

/** Collapses or expands a deck: in Anki's collection when it has the deck (sync carries it), else in Franki's settings. */
export async function setDeckCollapsed(store: NoteStore, deck: string, collapsed: boolean, now: Date = new Date()): Promise<void> {
  const inAnki = (await store.keptCollection())
    ? await store.lockAnki(() => store.withSyncConnection((db) => setAnkiDeckCollapsed(db, deck, collapsed, now)))
    : false;
  const settings = (await store.listDeckSettings()).get(deck) ?? {};
  const local = !inAnki && collapsed ? true : undefined;
  if (settings.collapsed !== local) await store.saveDeckSettings(deck, { ...settings, collapsed: local });
}
