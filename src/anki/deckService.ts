import { cleanDeckName, deckDeletion, matchParents, renameProblem, sameDeckName } from '../core/deckNames';
import { deckLineage, isInDeck } from '../core/deckTree';
import { addAnkiDeck, ankiDeckDeletion, DeckRefused, removeAnkiDeck, renameAnkiDeck } from './deckEdits';
import type { NoteStore } from './noteService';

export { DeckRefused };

/**
 * Making, renaming and deleting a deck from the deck list: in the kept Anki collection when
 * there is one (src/anki/deckEdits.ts), so sync and Send to Anki carry it back, and in Franki's
 * own tables either way. A deck Anki doesn't have (a TSV import's, or one made with no Anki
 * collection) lives in Franki's tables only.
 *
 * After a change in Anki, `refresh` reads Franki's decks from the kept collection again
 * (`refreshFromKeptCollection`), so a deck made there gets its preset's settings here.
 */

/** Every deck Franki has a name for: those its notes and cards are in, the ones made here, and their parents. */
async function frankiDecks(store: NoteStore): Promise<string[]> {
  const [notes, cards, settings] = await Promise.all([store.listNotes(), store.listCards(), store.listDeckSettings()]);
  const named = [
    ...notes.map((n) => n.deck),
    ...cards.flatMap((c) => [c.deck, c.filteredDeck]).filter((d): d is string => d !== undefined),
    ...[...settings].filter(([, s]) => s.created).map(([d]) => d),
  ];
  return [...new Set(named.flatMap(deckLineage))];
}

function checkedName(input: string): string {
  const r = cleanDeckName(input);
  if ('problem' in r) throw new DeckRefused(r.problem);
  return r.name;
}

/** Makes a deck called `input` ("A::B" makes B inside A). Returns its name as made. */
export async function createDeck(store: NoteStore, input: string, refresh: () => Promise<void>, now: Date = new Date()): Promise<string> {
  const name = checkedName(input);
  const known = await frankiDecks(store);
  const taken = known.find((d) => sameDeckName(d, name));
  if (taken) throw new DeckRefused(`A deck called "${taken}" already exists.`);
  if (await store.keptCollection()) {
    const made = await store.lockAnki(() => store.withSyncConnection((db) => addAnkiDeck(db, name, now)));
    await store.lockAnki(refresh);
    return made;
  }
  const made = matchParents(name, known);
  const settings = (await store.listDeckSettings()).get(made) ?? {};
  await store.saveDeckSettings(made, { ...settings, created: true });
  return made;
}

/** Renames the deck `from`, and every deck under it, to `input`. Returns the new name. */
export async function renameDeck(store: NoteStore, from: string, input: string, refresh: () => Promise<void>, now: Date = new Date()): Promise<string> {
  const to = checkedName(input);
  if (to === from) return from;
  const known = await frankiDecks(store);
  const problem = renameProblem(from, to, known);
  if (problem) throw new DeckRefused(problem);
  if (await store.keptCollection()) {
    const renamed = await store.lockAnki(() => store.withSyncConnection((db) => renameAnkiDeck(db, from, to, now)));
    if (renamed !== null) {
      await store.renameDeck(from, renamed);
      await store.lockAnki(refresh);
      return renamed;
    }
  }
  const renamed = matchParents(to, known.filter((d) => !isInDeck(d, from)));
  await store.renameDeck(from, renamed);
  return renamed;
}

/** What deleting a deck deletes: its cards, whether the deck is Anki's, and whether it stays (Anki's Default). */
export interface DeckDeletionPreview { cards: number; inAnki: boolean; keepsDeck: boolean }

/** What deleting `deck` deletes, to ask first. */
export async function deckDeletionPreview(store: NoteStore, deck: string): Promise<DeckDeletionPreview> {
  const [notes, cards] = await Promise.all([store.listNotes(), store.listCards()]);
  const { studied } = deckDeletion(notes, cards, deck);
  const anki = (await store.keptCollection())
    ? await store.lockAnki(() => store.withSyncConnection((db) => ankiDeckDeletion(db, deck)))
    : null;
  // Anki counts its own cards (some may be of a note type Franki shows only in part); Franki adds its own.
  if (anki) return { cards: anki.cards + studied.filter((c) => !c.ankiId).length, inAnki: true, keepsDeck: anki.keepsDeck };
  return { cards: studied.length, inAnki: false, keepsDeck: false };
}

/**
 * Deletes `deck` and every deck under it, with their cards and the notes left with none, as
 * Anki deletes a deck (`removeAnkiDeck`, `deckDeletion`). Review history stays in Anki, as there.
 */
export async function deleteDeck(store: NoteStore, deck: string, refresh: () => Promise<void>, now: Date = new Date()): Promise<void> {
  const inAnki = (await store.keptCollection())
    ? (await store.lockAnki(() => store.withSyncConnection((db) => removeAnkiDeck(db, deck, now)))) !== null
    : false;
  const [notes, cards] = await Promise.all([store.listNotes(), store.listCards()]);
  const plan = deckDeletion(notes, cards, deck);
  await store.deleteNotesAndCards(plan.notes, plan.cards);
  for (const c of plan.returnHome) await store.saveCard({ ...c, filteredDeck: undefined, filteredDue: undefined, previewDue: undefined });
  await store.forgetDeck(deck);
  if (inAnki) await store.lockAnki(refresh);
}
